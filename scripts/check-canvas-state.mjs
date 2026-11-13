#!/usr/bin/env node

// Guard for issue #647 (converge canvas state onto a single owner). Counts refs, setters and
// workspace-store writers against `scripts/canvas-state-ratchet.json`. The counters are defined in
// `scripts/lib/canvas-state-ratchet.mjs`; the rules are in DEVELOPMENT.md.
//
//   pnpm canvas:state-check     fails when any count differs from the baseline, up or down
//   pnpm canvas:state-ratchet   rewrites the baseline, refusing when any counter's total would rise
//
// The baseline path and the scanned roots are fixed here. Neither can be changed from the command
// line, so a rise cannot be waved through by pointing the check at another file.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  CANVAS_STATE_RULES,
  compareCanvasStateRatchet,
  countCanvasState,
  formatCanvasStateIssues,
  isCountedSourcePath,
  normalizeRepoPath,
  planCanvasStateUpdate,
  totalsOf,
} from './lib/canvas-state-ratchet.mjs'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const DEFAULT_REPO_ROOT = resolve(SCRIPT_DIR, '..')
const SOURCE_ROOT = 'src'
const BASELINE_FILE = 'scripts/canvas-state-ratchet.json'
const UPDATE_FLAG = '--update-ratchet'
const LABEL = '[canvas-state-check]'

function collectSourceFiles(directory, repoRoot, files) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = resolve(directory, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') {
        collectSourceFiles(absolutePath, repoRoot, files)
      }
      continue
    }
    const path = normalizeRepoPath(relative(repoRoot, absolutePath))
    if (entry.isFile() && isCountedSourcePath(path)) {
      files.push({ path, content: readFileSync(absolutePath, 'utf8') })
    }
  }
}

export function readCanvasStateFiles(repoRoot = DEFAULT_REPO_ROOT) {
  const files = []
  collectSourceFiles(resolve(repoRoot, SOURCE_ROOT), repoRoot, files)
  return files
}

// `null` when the file does not exist; any other read or parse failure throws.
function readBaseline(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return null
    }
    throw error
  }
}

function formatTotals(counts) {
  return CANVAS_STATE_RULES.map(rule => `${rule}=${totalsOf(counts)[rule]}`).join(' ')
}

export function runCanvasStateCheck({
  repoRoot = DEFAULT_REPO_ROOT,
  stderr = process.stderr,
  stdout = null,
  updateRatchet = false,
} = {}) {
  const files = readCanvasStateFiles(repoRoot)
  if (files.length === 0) {
    stderr.write(`${LABEL} examined 0 source files: this is not a pass.\n`)
    return 1
  }
  const counts = countCanvasState(files)
  const baselinePath = resolve(repoRoot, BASELINE_FILE)
  const baseline = readBaseline(baselinePath)

  if (updateRatchet) {
    const plan = planCanvasStateUpdate({ counts, baseline })
    if (!plan.ok) {
      for (const { rule, before, after } of plan.refusals) {
        stderr.write(
          `[canvas-state-ratchet] ${rule}: total would rise from ${before} to ${after}.\n`,
        )
      }
      stderr.write(
        'Refusing to grow the baseline. Remove the new refs, setters or workspace writes instead.\n',
      )
      return 1
    }
    writeFileSync(baselinePath, plan.serialized)
    stdout?.write(`[canvas-state-ratchet] wrote ${BASELINE_FILE}: ${formatTotals(counts)}\n`)
    return 0
  }

  if (baseline === null) {
    stderr.write(`${LABEL} ${BASELINE_FILE} is missing. Run \`pnpm canvas:state-ratchet\`.\n`)
    return 1
  }
  const issues = compareCanvasStateRatchet(counts, baseline)
  if (issues.length === 0) {
    stdout?.write(
      `${LABEL} examined ${files.length} source files, counts match the baseline (${formatTotals(counts)})\n`,
    )
    return 0
  }
  stderr.write(formatCanvasStateIssues(issues))
  return 1
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null
if (invokedPath === import.meta.url) {
  const args = process.argv.slice(2)
  const unknown = args.filter(arg => arg !== UPDATE_FLAG)
  if (unknown.length > 0) {
    process.stderr.write(
      `${LABEL} unsupported argument(s): ${unknown.join(' ')}. Only ${UPDATE_FLAG} is accepted; the baseline path is fixed.\n`,
    )
    process.exitCode = 2
  } else {
    process.exitCode = runCanvasStateCheck({
      stdout: process.stdout,
      updateRatchet: args.includes(UPDATE_FLAG),
    })
  }
}
