#!/usr/bin/env node
import { appendFileSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { BUDGET_DIRECTORY, collectCases, median, readBaselineParts } from './lib/e2e-report.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const OSES = ['ubuntu', 'macos']
const minute = ms => (ms / 60000).toFixed(2)
const second = ms => (ms / 1000).toFixed(2)
const escape = value =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('|', '&#124;')
    .replace(/[\r\n]/g, ' ')
const duration = value => {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid duration: ${value}`)
  }
  return value
}

export function readShardReports(directory, shardCount = 3) {
  const reports = [],
    warnings = []
  for (const os of OSES) {
    for (let shard = 1; shard <= shardCount; shard++) {
      const name = `${os}-${shard}.json`
      try {
        const report = JSON.parse(readFileSync(resolve(directory, name), 'utf8'))
        const plan = report.config?.metadata?.opencoveShardPlan
        const identity = plan ?? report.config?.shard
        if (identity?.current !== shard || identity?.total !== shardCount) {
          throw new Error('shard metadata does not match artifact name/matrix')
        }
        const cases = collectCases(report, { allowErrors: true, mergeRepeats: true })
        if (plan) {
          if (plan.os !== os || report.config?.shard) {
            throw new Error('planned shard OS mismatch or unexpected second shard filter')
          }
          duration(plan.estimatedMs)
          const files = [...new Set(cases.map(c => c.file))].sort()
          if (
            !Array.isArray(plan.files) ||
            JSON.stringify([...plan.files].sort()) !== JSON.stringify(files)
          ) {
            throw new Error('report files do not match planned shard files')
          }
        }
        duration(report.stats?.duration)
        reports.push({ os, shard, report })
      } catch (error) {
        warnings.push(`${name}: missing or broken report (${error.message})`)
      }
    }
  }
  return { reports, warnings }
}

function readTimings(report) {
  return collectCases(report, { allowErrors: true, mergeRepeats: true }).map(({ id, spec }) => {
    const results = (spec.tests ?? []).flatMap(test => test.results ?? [])
    const total = results.reduce((sum, result) => sum + duration(result.duration), 0)
    const finalStatuses = (spec.tests ?? []).map(t => t.results?.at(-1)?.status ?? 'notRun')
    const status =
      ['interrupted', 'notRun', 'timedOut', 'failed'].find(s => finalStatuses.includes(s)) ??
      (finalStatuses.includes('passed') ? 'passed' : results.length ? 'skipped' : 'notRun')
    const passed = results.filter(result => result.status === 'passed').map(r => r.duration)
    const skippedOnly = status === 'skipped' && results.every(r => r.status === 'skipped')
    return { id, total, status, skippedOnly, passedMs: passed.length ? median(passed) : undefined }
  })
}

export function durationBaseline(reports) {
  const samples = { ubuntu: new Map(), macos: new Map() }
  for (const { os, report } of reports) {
    for (const row of readTimings(report)) {
      if (!samples[os].has(row.id)) {
        samples[os].set(row.id, { passed: [], skippedOnly: true })
      }
      const sample = samples[os].get(row.id)
      sample.skippedOnly &&= row.skippedOnly
      if (row.passedMs !== undefined) {
        sample.passed.push(row.passedMs)
      }
    }
  }
  return Object.fromEntries(
    OSES.map(os => [
      os,
      Object.fromEntries(
        [...samples[os]]
          .filter(([, sample]) => sample.passed.length || sample.skippedOnly)
          .map(([id, sample]) => [id, sample.passed.length ? median(sample.passed) : 0]),
      ),
    ]),
  )
}

export function summarizeDurations(reports, baseline, inputWarnings = []) {
  const warnings = [...inputWarnings],
    shards = [],
    rows = []
  const seenShards = new Set()
  for (const { os, shard, report } of reports) {
    try {
      const key = `${os}-${shard}`
      if (seenShards.has(key)) {
        throw new Error('duplicate shard')
      }
      seenShards.add(key)
      const tests = readTimings(report)
      const wall = duration(report.stats?.duration)
      const estimate = report.config?.metadata?.opencoveShardPlan?.estimatedMs
      const counts = {}
      for (const test of tests) {
        counts[test.status] = (counts[test.status] ?? 0) + 1
      }
      const partial = !tests.length || tests.some(t => ['notRun', 'interrupted'].includes(t.status))
      if (partial) {
        warnings.push(`${key}: partial run; missing/interrupted work is not a saving.`)
      }
      for (const error of report.errors ?? []) {
        warnings.push(`${key}: ${error.message ?? 'runner error'}`)
      }
      shards.push({
        os,
        shard,
        wall,
        estimatedMs: estimate === undefined ? undefined : duration(estimate),
        total: tests.reduce((sum, t) => sum + t.total, 0),
        counts,
        partial,
      })
      rows.push(...tests.map(t => ({ ...t, os, shard })))
    } catch (error) {
      warnings.push(`${os}-${shard}: broken report (${error.message})`)
    }
  }
  const lines = [
    '# Electron E2E durations (informational)',
    '',
    'Serial = sum of all test attempts, including failures/retries. Wall = Playwright run duration, including shared hooks/runner overhead. Skipped/not-run cases contribute no measured cost. Interrupted timings are censored; partial runs are not savings.',
    '',
    '## Per-shard minutes',
    '',
    'Estimated = the whole-file plan recorded before execution; unknown cases use the OS median. Legacy --shard reports have no estimate.',
    '',
    '| OS | Shard | Serial min | Wall min | Estimated min | Outcomes |',
    '| --- | --- | ---: | ---: | ---: | --- |',
  ]
  for (const s of shards) {
    const outcomes = Object.entries(s.counts)
      .map(([status, count]) => `${status}: ${count}`)
      .join(', ')
    lines.push(
      `| ${s.os} | ${s.shard} | ${minute(s.total)} | ${minute(s.wall)} | ${s.estimatedMs === undefined ? 'n/a' : minute(s.estimatedMs)} | ${outcomes}${s.partial ? ' (partial)' : ''} |`,
    )
  }
  if (!shards.length) {
    lines.push('', 'No usable shard reports.')
  }
  lines.push(
    '',
    '## Totals per OS',
    '',
    '| OS | Reports | Serial min | Sum of shard wall min |',
    '| --- | ---: | ---: | ---: |',
  )
  for (const os of OSES) {
    const subset = shards.filter(s => s.os === os)
    lines.push(
      `| ${os} | ${subset.length}/3 | ${minute(subset.reduce((sum, s) => sum + s.total, 0))} | ${minute(subset.reduce((sum, s) => sum + s.wall, 0))} |`,
    )
  }
  lines.push(
    '',
    '## Growth against baseline',
    '',
    'Compare medians of passed attempts for the same IDs only; coverage shows matched/baseline IDs. New, skipped, failed and absent cases never count as a reduction. Baselines are reviewed, never updated by CI.',
    '',
    '| OS | Matched/baseline | Current min | Baseline min | Growth |',
    '| --- | ---: | ---: | ---: | --- |',
  )
  for (const os of OSES) {
    const old = baseline[os] ?? {}
    const passed = new Map()
    for (const row of rows.filter(
      r => r.os === os && r.status === 'passed' && r.passedMs !== undefined,
    )) {
      if (!passed.has(row.id)) {
        passed.set(row.id, [])
      }
      passed.get(row.id).push(row.passedMs)
    }
    const comparable = [...passed].filter(([id]) => Number.isFinite(old[id]) && old[id] > 0)
    const now = comparable.reduce((sum, [, values]) => sum + median(values), 0)
    const before = comparable.reduce((sum, [id]) => sum + old[id], 0)
    const delta = now - before
    const growth = before
      ? `${delta >= 0 ? '+' : ''}${minute(delta)} (${delta >= 0 ? '+' : ''}${((delta / before) * 100).toFixed(1)}%)`
      : 'n/a'
    lines.push(
      `| ${os} | ${comparable.length}/${Object.keys(old).length} | ${minute(now)} | ${minute(before)} | ${growth} |`,
    )
  }
  const slowest = [...rows].sort((a, b) => b.total - a.total || a.id.localeCompare(b.id))
  lines.push(
    '',
    '## 20 slowest tests',
    '',
    '| OS/shard | Test | Seconds (all attempts) | Outcome |',
    '| --- | --- | ---: | --- |',
  )
  for (const row of slowest.filter(r => r.total > 0).slice(0, 20)) {
    lines.push(
      `| ${row.os}/${row.shard} | ${escape(row.id)} | ${second(row.total)} | ${row.status} |`,
    )
  }
  lines.push(
    '',
    '## New tests over 15 s',
    '',
    'IDs absent from the previous duration baseline (may include previously untimed cases).',
    '',
    '| OS | Test | Seconds (all attempts) | Outcome |',
    '| --- | --- | ---: | --- |',
  )
  const newSlow = slowest.filter(r => r.total > 15000 && !Object.hasOwn(baseline[r.os] ?? {}, r.id))
  for (const row of newSlow) {
    lines.push(`| ${row.os} | ${escape(row.id)} | ${second(row.total)} | ${row.status} |`)
  }
  if (!newSlow.length) {
    lines.push('', 'None observed.')
  }
  if (warnings.length) {
    lines.push('', '## Warnings', '', ...warnings.map(w => `- WARNING: ${escape(w)}`))
  }
  return `${lines.join('\n')}\n`
}

function main() {
  const directory = resolve(process.argv[2] ?? 'artifacts/e2e-durations')
  const { reports, warnings } = readShardReports(directory)
  const baseline = {}
  for (const os of OSES) {
    try {
      baseline[os] = readBaselineParts(resolve(ROOT, BUDGET_DIRECTORY), `duration-${os}`)
    } catch (error) {
      warnings.push(`${os}: cannot read duration baseline (${error.message})`)
    }
  }
  const summary = summarizeDurations(reports, baseline, warnings)
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary)
  } else {
    process.stdout.write(summary)
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    main()
  } catch (error) {
    const warning = `\nWARNING: E2E duration reporting failed: ${escape(error.message)}\n`
    process.stderr.write(warning)
    try {
      if (process.env.GITHUB_STEP_SUMMARY) {
        appendFileSync(process.env.GITHUB_STEP_SUMMARY, warning)
      }
    } catch {
      /* A broken summary destination must not affect correctness CI. */
    }
  }
}
