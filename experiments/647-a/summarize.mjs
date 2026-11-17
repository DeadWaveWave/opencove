#!/usr/bin/env node
// Experiment 647-A summarizer. No dependencies.
//
//   node summarize.mjs <replica-dir>                 one replica (any directory below it that holds trial files)
//   node summarize.mjs --combined [--out <dir>] <dir>...   several replicas / attempts and the verdict
//
// A replica is a directory holding the files run-trials.sh wrote: r<k>-<side>-drag-commits.{json,exit,log}
// and r<k>-<side>-perf/{timings.json,canvas-zoom.json,drag.cpuprofile} (+ pair.json, runner.json).
// Sides are labelled from the file names, never from timings.json's `revision`.
// Rules: docs in the experiment's design note, section 5.

import fs from 'node:fs'
import path from 'node:path'

const print = text => process.stdout.write(`${text}\n`)
const printError = text => process.stderr.write(`${text}\n`)

const MOVING = 'drag-note-7'
const SIDES = ['baseline', 'spike']
const BUDGET = { fpsPercent: 95, p95Ms: 2 }
// The width of one budget step, used to decide that a runner "cannot resolve the budget".
const BUDGET_WIDTH = { fps: 5, p95: 2, longFrames: 1 }

// ---------------------------------------------------------------- helpers

const median = values => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b)
  if (sorted.length === 0) {
    return null
  }
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}
const range = values => {
  const finite = values.filter(Number.isFinite)
  return finite.length === 0 ? null : Math.max(...finite) - Math.min(...finite)
}
const sum = values => values.reduce((total, value) => total + value, 0)
const fmt = (value, digits = 1) =>
  value === null || value === undefined || !Number.isFinite(value)
    ? 'n/a'
    : Number(value.toFixed(digits)).toString()
const sha = value => (typeof value === 'string' ? value.slice(0, 8) : 'n/a')

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}
function readExit(file) {
  try {
    return Number.parseInt(fs.readFileSync(file, 'utf8').trim(), 10)
  } catch {
    return null
  }
}

/** The `drag-commits` attachment of a Playwright JSON report (its body is base64). */
function readDragAttachment(file) {
  const report = readJson(file)
  if (!report) {
    return null
  }
  let found = null
  const visit = suite => {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        for (const result of test.results ?? []) {
          for (const attachment of result.attachments ?? []) {
            if (attachment.name === 'drag-commits' && attachment.body && !found) {
              try {
                found = JSON.parse(Buffer.from(attachment.body, 'base64').toString('utf8'))
              } catch {
                /* Unreadable attachment: treated as no numbers. */
              }
            }
          }
        }
      }
    }
    for (const child of suite.suites ?? []) {
      visit(child)
    }
  }
  for (const suite of report.suites ?? []) {
    visit(suite)
  }
  return found
}

/** Busy ms per frame of a profiled 120-frame drag: samples whose node is not (idle). */
function readProfileBusyMs(file, frames = 120) {
  const profile = readJson(file)
  if (!profile?.nodes || !profile.samples || !profile.timeDeltas) {
    return null
  }
  const idle = new Set(
    profile.nodes.filter(node => node.callFrame?.functionName === '(idle)').map(node => node.id),
  )
  let busyUs = 0
  profile.samples.forEach((nodeId, index) => {
    if (!idle.has(nodeId)) {
      busyUs += profile.timeDeltas[index] ?? 0
    }
  })
  return busyUs / 1000 / frames
}

function dragMetrics(drag) {
  const nonMoving = record =>
    sum(
      Object.entries(record ?? {})
        .filter(([id]) => id !== MOVING)
        .map(([, count]) => count),
    )
  const commits = drag.canvasCommits
  return {
    frames: drag.frames,
    fps: drag.fps,
    p95: drag.p95,
    longFrames: drag.longFrames,
    longFrameMs: drag.longFrameMs,
    inner: commits ? (commits.WorkspaceCanvasInner ?? 0) : null,
    // Commits whose probe record lists no changed prop; the rest came from the parent.
    innerInternal: drag.canvasCommitCauses
      ? (drag.canvasCommitCauses['WorkspaceCanvasInner:internal'] ?? 0)
      : null,
    host: commits ? (commits.CanvasFlowHost ?? 0) : null,
    nonMovingHeaders: nonMoving(drag.windowCommitsByNode),
    nonMovingShells: nonMoving(drag.presentationCommits),
    canvasCommitCauses: drag.canvasCommitCauses ?? null,
    innerProp:
      commits && drag.canvasCommitCauses
        ? (commits.WorkspaceCanvasInner ?? 0) -
          (drag.canvasCommitCauses['WorkspaceCanvasInner:internal'] ?? 0)
        : null,
    seconds: drag.fps > 0 ? drag.frames / drag.fps : null,
    inputToCommitMs: Number.isFinite(drag.inputToCommitMs) ? drag.inputToCommitMs : null,
  }
}

// ---------------------------------------------------------------- loading a replica

function findReplicaDirs(root) {
  const found = []
  const walk = directory => {
    let entries
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true })
    } catch {
      return
    }
    if (entries.some(entry => /^r\d+-(baseline|spike)-drag-commits\./.test(entry.name))) {
      found.push(directory)
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        walk(path.join(directory, entry.name))
      }
    }
  }
  walk(root)
  return found
}

function loadReplica(directory, label) {
  const names = fs.readdirSync(directory)
  const rounds = new Set()
  const sides = { baseline: { dragCommits: [], perf: [] }, spike: { dragCommits: [], perf: [] } }
  for (const name of names) {
    const match = /^r(\d+)-(baseline|spike)-drag-commits\.(json|exit|log)$/.exec(name)
    if (match) {
      rounds.add(Number(match[1]))
    }
  }
  for (const round of [...rounds].sort((a, b) => a - b)) {
    for (const side of SIDES) {
      const prefix = path.join(directory, `r${round}-${side}`)
      const exitCode = readExit(`${prefix}-drag-commits.exit`)
      const drag = readDragAttachment(`${prefix}-drag-commits.json`)
      if (exitCode !== null || drag) {
        sides[side].dragCommits.push({
          round,
          exit: exitCode,
          drag: drag ? dragMetrics(drag) : null,
        })
      }
      const perfDir = `${prefix}-perf`
      const perfExit = readExit(`${perfDir}.exit`)
      const timings = readJson(path.join(perfDir, 'timings.json'))
      if (perfExit !== null || timings) {
        const zoom = readJson(path.join(perfDir, 'canvas-zoom.json'))
        sides[side].perf.push({
          round,
          exit: perfExit,
          gpu: timings?.gpu ?? null,
          drags: (timings?.results ?? []).map(dragMetrics),
          zoom,
          busyMsPerFrame: readProfileBusyMs(path.join(perfDir, 'drag.cpuprofile')),
        })
      }
    }
  }
  return {
    label,
    directory,
    rounds: [...rounds].sort((a, b) => a - b),
    pair: readJson(path.join(directory, 'pair.json')),
    runner: readJson(path.join(directory, 'runner.json')),
    sides,
  }
}

// ---------------------------------------------------------------- checks

const result = (id, status, text, short) => ({ id, status, text, short })

function checkA1(replica) {
  const exits = side => replica.sides[side].dragCommits.map(trial => trial.exit)
  const ok = side => exits(side).filter(code => code === 0).length
  const count = side => exits(side).length
  const spike = `spike ${ok('spike')}/${count('spike')}, baseline ${ok('baseline')}/${count('baseline')}`
  const short = `${ok('spike')}/${count('spike')}`
  if (count('spike') === 0 || count('baseline') === 0) {
    return result(
      'A1',
      'INCONCLUSIVE',
      `A1 drag-commits green: no runs of both sides (${spike})`,
      short,
    )
  }
  const baselineGreen = ok('baseline') === count('baseline')
  const spikeGreen = ok('spike') === count('spike')
  if (!baselineGreen) {
    return result(
      'A1',
      'INCONCLUSIVE',
      `A1 drag-commits green: the baseline failed a run (${spike})`,
      short,
    )
  }
  return result('A1', spikeGreen ? 'PASS' : 'FAIL', `A1 drag-commits green: ${spike}`, short)
}

/** Inner commits split into total, internal state and prop-driven, with the top prop names. */
function innerSplit(drags) {
  const props = {}
  for (const drag of drags) {
    for (const [key, count] of Object.entries(drag.canvasCommitCauses ?? {})) {
      const match = /^WorkspaceCanvasInner:(.+)$/.exec(key)
      if (match && match[1] !== 'internal') {
        props[match[1]] = (props[match[1]] ?? 0) + count
      }
    }
  }
  const top = Object.entries(props)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name, count]) => `${name} x${count}`)
    .join(', ')
  return {
    total: median(drags.map(drag => drag.inner)),
    internal: median(drags.map(drag => drag.innerInternal)),
    prop: median(drags.map(drag => drag.innerProp)),
    top: top || 'none',
  }
}

const splitText = (drags, withRuns) => {
  const split = innerSplit(drags)
  const runs = key => (withRuns ? ` (${drags.map(drag => fmt(drag[key], 0)).join(', ')})` : '')
  return `total ${fmt(split.total, 0)}${runs('inner')}, internal ${fmt(split.internal, 0)}${runs('innerInternal')}, prop-driven ${fmt(split.prop, 0)}${runs('innerProp')} [${split.top}]`
}

/** Prop-driven Inner commits per second of drag. */
const propRate = drags => {
  const rates = drags
    .filter(drag => drag.innerProp !== null && drag.seconds)
    .map(drag => drag.innerProp / drag.seconds)
  return median(rates)
}

function checkA2(replica) {
  const dragsOf = side => replica.sides[side].dragCommits.map(trial => trial.drag).filter(Boolean)
  const spike = dragsOf('spike')
  const baseline = dragsOf('baseline')
  const frames =
    median(baseline.map(drag => drag.frames)) ?? median(spike.map(drag => drag.frames)) ?? 120
  const baselineInternal = median(baseline.map(drag => drag.innerInternal))
  const hostMedian = median(spike.map(drag => drag.host))
  const spikeInternal = spike.map(drag => drag.innerInternal)
  const text = `A2 WorkspaceCanvasInner internal-state commits in a ${fmt(frames, 0)}-frame drag <= 2: spike max ${fmt(spikeInternal.length ? Math.max(...spikeInternal) : null, 0)}; baseline median ${fmt(baselineInternal, 0)} (${fmt(baselineInternal / frames, 2)}/frame); host median ${fmt(hostMedian, 0)}; baseline ${splitText(baseline, false)}; spike ${splitText(spike, true)}`
  const short = `${fmt(baselineInternal, 0)} → ${fmt(spikeInternal.length ? Math.max(...spikeInternal) : null, 0)}`
  if (spike.length === 0 || baseline.length === 0) {
    return result('A2', 'INCONCLUSIVE', `${text} (no drag numbers on both sides)`, short)
  }
  if (
    spikeInternal.some(value => value === null) ||
    baseline.some(drag => drag.innerInternal === null)
  ) {
    return result('A2', 'INCONCLUSIVE', `${text} (the counter or its causes are missing)`, short)
  }
  const sanity = baselineInternal >= frames / 2 && hostMedian >= frames / 2
  if (!sanity) {
    const why = [
      baselineInternal >= frames / 2 ? null : 'the baseline does not commit about once per frame',
      hostMedian >= frames / 2 ? null : 'the live nodes do not flow through the host',
    ]
      .filter(Boolean)
      .join('; ')
    return result('A2', 'INCONCLUSIVE', `${text} (sanity condition fails: ${why})`, short)
  }
  const pass = spikeInternal.every(value => value <= 2)
  return result('A2', pass ? 'PASS' : 'FAIL', text, short)
}

function perfDragsOf(replica, side) {
  return replica.sides[side].perf.flatMap(trial => trial.drags)
}
/** Medians of each launch (three drags in one launch), one value per round. */
function launchMedians(replica, side, key) {
  return replica.sides[side].perf
    .map(trial => median(trial.drags.map(drag => drag[key])))
    .filter(value => value !== null)
}

/** Shared verdict of a timing check, see section 5 (A3 to A5). */
function timingVerdict({ meets, miss, band, budgetWidth }) {
  if (meets) {
    return 'PASS'
  }
  if (band === null) {
    return 'INCONCLUSIVE'
  }
  if (miss <= band) {
    return 'INCONCLUSIVE'
  }
  if (band > budgetWidth) {
    return 'INCONCLUSIVE'
  }
  return 'FAIL'
}

function checkTiming(replica, { id, key, label, budgetWidth, compare }) {
  const spike = median(perfDragsOf(replica, 'spike').map(drag => drag[key]))
  const baseline = median(perfDragsOf(replica, 'baseline').map(drag => drag[key]))
  if (spike === null || baseline === null) {
    return result(id, 'INCONCLUSIVE', `${id} ${label}: no perf drags on both sides`, 'n/a')
  }
  const launches = launchMedians(replica, 'baseline', key)
  const medianOfLaunches = median(launches)
  const rawBand = launches.length >= 2 ? range(launches) : null
  return compare({ spike, baseline, rawBand, medianOfLaunches, budgetWidth })
}

function checkA3(replica) {
  return checkTiming(replica, {
    id: 'A3',
    key: 'fps',
    label: 'median drag fps >= 95% of baseline',
    budgetWidth: BUDGET_WIDTH.fps,
    compare: ({ spike, baseline, rawBand, medianOfLaunches }) => {
      const percent = (spike / baseline) * 100
      const band = rawBand === null ? null : (rawBand / medianOfLaunches) * 100
      const status = timingVerdict({
        meets: percent >= BUDGET.fpsPercent,
        miss: BUDGET.fpsPercent - percent,
        band,
        budgetWidth: BUDGET_WIDTH.fps,
      })
      return result(
        'A3',
        status,
        `A3 median drag fps >= 95% of baseline: spike ${fmt(spike)} / baseline ${fmt(baseline)} = ${fmt(percent)}% (noise band ${fmt(band)}${band === null ? '' : '%'})`,
        `${fmt(percent)}%`,
      )
    },
  })
}

function checkA4(replica) {
  return checkTiming(replica, {
    id: 'A4',
    key: 'p95',
    label: 'median p95 frame interval <= baseline + 2 ms',
    budgetWidth: BUDGET_WIDTH.p95,
    compare: ({ spike, baseline, rawBand }) => {
      const delta = spike - baseline
      const status = timingVerdict({
        meets: delta <= BUDGET.p95Ms,
        miss: delta - BUDGET.p95Ms,
        band: rawBand,
        budgetWidth: BUDGET_WIDTH.p95,
      })
      return result(
        'A4',
        status,
        `A4 median p95 frame interval <= baseline + 2 ms: ${fmt(spike)} - ${fmt(baseline)} = ${delta >= 0 ? '+' : ''}${fmt(delta)} ms (noise band ${fmt(rawBand)}${rawBand === null ? '' : ' ms'})`,
        `${delta >= 0 ? '+' : ''}${fmt(delta)} ms`,
      )
    },
  })
}

function checkA5(replica) {
  return checkTiming(replica, {
    id: 'A5',
    key: 'longFrames',
    label: 'median long animation frames per drag <= baseline',
    budgetWidth: BUDGET_WIDTH.longFrames,
    compare: ({ spike, baseline, rawBand }) => {
      const status = timingVerdict({
        meets: spike <= baseline,
        miss: spike - baseline,
        band: rawBand,
        budgetWidth: BUDGET_WIDTH.longFrames,
      })
      return result(
        'A5',
        status,
        `A5 median long animation frames per drag <= baseline: ${fmt(spike)} vs ${fmt(baseline)} (noise band ${fmt(rawBand)})`,
        `${fmt(spike)} vs ${fmt(baseline)}`,
      )
    },
  })
}

function checkA6(replica) {
  const allDrags = side => [
    ...replica.sides[side].dragCommits.map(trial => trial.drag).filter(Boolean),
    ...perfDragsOf(replica, side),
  ]
  const spike = allDrags('spike')
  const baseline = allDrags('baseline')
  const max = (drags, key) => (drags.length ? Math.max(...drags.map(drag => drag[key])) : null)
  const spikeHeaders = max(spike, 'nonMovingHeaders')
  const spikeShells = max(spike, 'nonMovingShells')
  const baselineHeaders = max(baseline, 'nonMovingHeaders')
  const baselineShells = max(baseline, 'nonMovingShells')
  const text = `A6 commits of non-moving windows = 0: spike max headers ${fmt(spikeHeaders, 0)}, shells ${fmt(spikeShells, 0)} over ${spike.length} drags; baseline max headers ${fmt(baselineHeaders, 0)}, shells ${fmt(baselineShells, 0)} over ${baseline.length} drags`
  const short = `${fmt(Math.max(spikeHeaders ?? 0, spikeShells ?? 0), 0)}`
  if (spike.length === 0 || baseline.length === 0) {
    return result('A6', 'INCONCLUSIVE', `${text} (no drags on both sides)`, short)
  }
  if ((baselineHeaders ?? 0) > 0 || (baselineShells ?? 0) > 0) {
    return result('A6', 'INCONCLUSIVE', text, short)
  }
  return result('A6', spikeHeaders > 0 || spikeShells > 0 ? 'FAIL' : 'PASS', text, short)
}

function infoLines(replica) {
  const lines = []
  const baselineDrags = perfDragsOf(replica, 'baseline')
  const spikeDrags = perfDragsOf(replica, 'spike')
  const frames = median(baselineDrags.map(drag => drag.frames)) ?? 240
  lines.push(
    `[INFO] perf drag WorkspaceCanvasInner commits (${fmt(frames, 0)} frames), median per drag: baseline ${splitText(baselineDrags, false)}; spike ${splitText(spikeDrags, false)}`,
  )
  lines.push(
    `[INFO] prop-driven WorkspaceCanvasInner commits per second (median): drag-commits baseline ${fmt(propRate(replica.sides.baseline.dragCommits.map(trial => trial.drag).filter(Boolean)), 2)}, spike ${fmt(propRate(replica.sides.spike.dragCommits.map(trial => trial.drag).filter(Boolean)), 2)}; perf drags baseline ${fmt(propRate(baselineDrags), 2)}, spike ${fmt(propRate(spikeDrags), 2)}`,
  )
  const busy = side =>
    median(
      replica.sides[side].perf.map(trial => trial.busyMsPerFrame).filter(value => value !== null),
    )
  lines.push(
    `[INFO] JS busy ms per frame (profiled drag): baseline ${fmt(busy('baseline'))}, spike ${fmt(busy('spike'))}`,
  )
  const latency = drags =>
    median(drags.map(drag => drag.inputToCommitMs).filter(value => Number.isFinite(value)))
  lines.push(
    `[INFO] input to commit ms (median per drag, then median): baseline ${fmt(latency(baselineDrags))}, spike ${fmt(latency(spikeDrags))}`,
  )
  const dc = (side, key) =>
    median(replica.sides[side].dragCommits.map(trial => trial.drag?.[key]).filter(Number.isFinite))
  lines.push(
    `[INFO] drag-commits timing (24 windows): fps ${fmt(dc('baseline', 'fps'))} -> ${fmt(dc('spike', 'fps'))}, p95 ${fmt(dc('baseline', 'p95'), 0)} -> ${fmt(dc('spike', 'p95'), 0)} ms, long frames ${fmt(dc('baseline', 'longFrames'), 0)} -> ${fmt(dc('spike', 'longFrames'), 0)}`,
  )
  const warnings = []
  for (const farView of ['on', 'off']) {
    const zoom = (side, key) =>
      median(
        replica.sides[side].perf
          .map(trial => trial.zoom?.[`farView:${farView}`]?.[key])
          .filter(Number.isFinite),
      )
    const baselineFps = zoom('baseline', 'fps')
    const spikeFps = zoom('spike', 'fps')
    lines.push(
      `[INFO] zoom far view ${farView}: fps ${fmt(baselineFps, 0)} -> ${fmt(spikeFps, 0)}, p95 ${fmt(zoom('baseline', 'p95'), 0)} -> ${fmt(zoom('spike', 'p95'), 0)} ms, long frame ms ${fmt(zoom('baseline', 'longFrameMs'), 0)} -> ${fmt(zoom('spike', 'longFrameMs'), 0)}`,
    )
    if (baselineFps && spikeFps !== null && spikeFps < baselineFps * 0.95) {
      warnings.push(
        `[WARN] zoom far view ${farView}: spike fps ${fmt(spikeFps, 0)} is below 95% of baseline ${fmt(baselineFps, 0)}`,
      )
    }
  }
  return [...lines, ...warnings]
}

/** One verdict from several statuses: any FAIL fails, all PASS passes, anything else is open. */
const experimentVerdict = statuses =>
  statuses.includes('FAIL')
    ? 'FAIL'
    : statuses.every(status => status === 'PASS')
      ? 'PASS'
      : 'INCONCLUSIVE'

/** The same checks over several replicas: PASS only if all PASS, FAIL only if some FAIL and none PASS. */
function combineStatuses(statuses) {
  if (statuses.length > 0 && statuses.every(status => status === 'PASS')) {
    return 'PASS'
  }
  if (statuses.includes('PASS')) {
    return 'INCONCLUSIVE'
  }
  return statuses.includes('FAIL') ? 'FAIL' : 'INCONCLUSIVE'
}

function summarizeReplica(replica) {
  const checks = [
    checkA1(replica),
    checkA2(replica),
    checkA3(replica),
    checkA4(replica),
    checkA5(replica),
    checkA6(replica),
  ]
  const gpu = replica.sides.baseline.perf.find(trial => trial.gpu)?.gpu ?? null
  const gpuText = gpu
    ? `gpu_compositing=${gpu.gpu_compositing ?? 'n/a'} webgl=${gpu.webgl ?? 'n/a'}`
    : 'n/a'
  const header = `Experiment A (#647) replica ${replica.label}  base ${sha(replica.pair?.base)}  baseline ${sha(replica.pair?.baseline)}  spike ${sha(replica.pair?.spike)}  rounds ${replica.rounds.length}  gpu ${gpuText}`
  const verdict = experimentVerdict(checks.map(check => check.status))
  const lines = [
    header,
    ...checks.map(check => `[${check.status}] ${check.text}`),
    ...infoLines(replica),
    `VERDICT ${replica.label}: ${verdict}`,
  ]
  return { replica, checks, verdict, header, lines, gpu }
}

// ---------------------------------------------------------------- output

const CHECK_TITLES = {
  A1: 'A1 drag-commits green (spike)',
  A2: 'A2 `WorkspaceCanvasInner` commits per 120-frame drag (baseline → spike)',
  A3: 'A3 median drag fps (spike / baseline)',
  A4: 'A4 p95 frame interval (Δ ms)',
  A5: 'A5 long animation frames per drag (median)',
  A6: 'A6 non-moving window commits (spike)',
}

function markdownTable(summaries, combined) {
  const head = `| Check | ${summaries.map(entry => entry.replica.label).join(' | ')} |${combined ? ' Result |' : ''}`
  const rule = `| --- |${summaries.map(() => ' --- |').join('')}${combined ? ' --- |' : ''}`
  const rows = Object.keys(CHECK_TITLES).map(id => {
    const cells = summaries.map(entry => {
      const check = entry.checks.find(item => item.id === id)
      return `${check.status}: ${check.short}`
    })
    const total = combined
      ? ` ${combineStatuses(summaries.map(entry => entry.checks.find(item => item.id === id).status))} |`
      : ''
    return `| ${CHECK_TITLES[id]} | ${cells.join(' | ')} |${total}`
  })
  return [head, rule, ...rows].join('\n')
}

function toJson(summary) {
  const { replica } = summary
  return {
    label: replica.label,
    pair: replica.pair,
    runner: replica.runner,
    rounds: replica.rounds,
    gpu: summary.gpu,
    verdict: summary.verdict,
    checks: summary.checks,
    sides: replica.sides,
  }
}

function main() {
  const args = process.argv.slice(2)
  const combined = args[0] === '--combined'
  const rest = combined ? args.slice(1) : args
  let outDir = null
  const inputs = []
  for (let index = 0; index < rest.length; index++) {
    if (rest[index] === '--out') {
      outDir = rest[++index]
    } else {
      inputs.push(rest[index])
    }
  }
  if (inputs.length === 0) {
    printError('usage: summarize.mjs <replica-dir> | --combined [--out <dir>] <dir>...')
    process.exit(2)
  }
  if (!combined && inputs.length !== 1) {
    printError('a single replica takes one directory; use --combined for several')
    process.exit(2)
  }

  const directories = inputs
    .filter(input => fs.existsSync(input) && fs.statSync(input).isDirectory())
    .flatMap(input => findReplicaDirs(input).map(directory => ({ input, directory })))
  if (directories.length === 0) {
    printError('::error::no trial files found under ' + inputs.join(', '))
    process.exit(1)
  }
  const used = new Map()
  const replicas = directories.map(({ directory }) => {
    const attempt = /attempt-(\d+)/.exec(directory)
    let label = path.basename(directory) + (attempt ? `@a${attempt[1]}` : '')
    const seen = used.get(label) ?? 0
    used.set(label, seen + 1)
    if (seen > 0) {
      label += `#${seen + 1}`
    }
    return loadReplica(directory, label)
  })
  const summaries = replicas.map(summarizeReplica)

  const sections = []
  for (const summary of summaries) {
    print(summary.lines.join('\n'))
    print('')
    sections.push(
      `### ${summary.header}\n\n${markdownTable([summary], false)}\n\n${summary.lines
        .filter(line => line.startsWith('[INFO]') || line.startsWith('[WARN]'))
        .map(line => `- ${line}`)
        .join('\n')}\n\n**VERDICT ${summary.replica.label}: ${summary.verdict}**`,
    )
    if (!combined) {
      const target = summary.replica.directory
      fs.writeFileSync(
        path.join(target, 'summary.json'),
        JSON.stringify(toJson(summary), null, 2) + '\n',
      )
      fs.writeFileSync(path.join(target, 'summary.md'), sections[0] + '\n')
    }
  }
  if (!combined) {
    return
  }

  const perCheck = Object.keys(CHECK_TITLES).map(id => {
    const statuses = summaries.map(entry => entry.checks.find(item => item.id === id).status)
    return { id, status: combineStatuses(statuses), statuses }
  })
  const verdict = experimentVerdict(perCheck.map(check => check.status))
  print('Combined (all replicas)')
  for (const check of perCheck) {
    print(`[${check.status}] ${check.id}  per replica: ${check.statuses.join(', ')}`)
  }
  print(`VERDICT combined: ${verdict}`)
  const table = markdownTable(summaries, true)
  print('\n' + table)

  const target = outDir ?? path.dirname(path.resolve(inputs[0]))
  fs.mkdirSync(target, { recursive: true })
  fs.writeFileSync(
    path.join(target, 'summary-all.json'),
    JSON.stringify({ verdict, perCheck, replicas: summaries.map(toJson) }, null, 2) + '\n',
  )
  fs.writeFileSync(
    path.join(target, 'summary-all.md'),
    `## Experiment A: ${verdict}\n\n${table}\n\n${sections.join('\n\n')}\n`,
  )
  if (verdict === 'PASS') {
    print(`::notice::Experiment A (#647): PASS`)
  } else {
    print(`::error::Experiment A (#647): ${verdict}`)
    process.exitCode = 1
  }
}

main()
