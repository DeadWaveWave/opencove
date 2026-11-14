#!/usr/bin/env node

// Guard for tests that run less than they look like they run (issue #683). Two hard-zero rules and
// one ratchet, all over tracked `tests/**/*.ts(x)` and `src/**/*.spec.ts(x)`:
//
//   platform-gate-suffix  a test gated to one non-Linux platform lives in a file named for it
//                         (`*.windows.spec.ts`, `*.mac.spec.ts`), which that platform's CI job
//                         selects by glob
//   focused-test          no `test.only`, `it.only`, `describe.only` or `test.describe.only`
//   unconditional-skip    ratchet: skipped tests (`test.skip('title', fn)`, `test.describe.skip`,
//                         `test.skip()`) are counted per file against
//                         `scripts/test-gates-ratchet.json`, and the count may only fall
//
// The rules and the scanner are in `scripts/lib/test-gates.mjs`; the policy is in DEVELOPMENT.md.
//
//   pnpm test-gates:check    fails when a hard rule is violated or a count differs from the baseline
//   pnpm test-gates:ratchet  rewrites the baseline, refusing when the total would rise against the
//                            merge base with origin/main, unless the rule is named with
//                            --accept-rise <rule> (see DEVELOPMENT.md)
//   --verbose   also list the conditions that mention a platform but could not be evaluated
// The baseline path and the scanned roots are fixed here. Neither can be changed from the command
// line, so a rise cannot be waved through by pointing the check at another file.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { listRepositoryFiles } from './lib/repo-files.mjs'
import { guardRatchetUpdate, parseAcceptRises } from './lib/ratchet-git.mjs'
import { totalOf } from './lib/canvas-state-ratchet.mjs'
import {
  compareTestGatesRatchet,
  evaluateTestGates,
  formatTestGateFindings,
  formatTestGatesRatchetIssues,
  isTestGateSourcePath,
  serializeTestGatesRatchet,
} from './lib/test-gates.mjs'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const DEFAULT_REPO_ROOT = resolve(SCRIPT_DIR, '..')
const BASELINE_FILE = 'scripts/test-gates-ratchet.json'
const UPDATE_FLAG = '--update-ratchet'
const VERBOSE_FLAG = '--verbose'
const LABEL = '[test-gates]'

// Tracked files that are gone from the disk (deleted, not yet committed) are not tests any more.
function readTestGateFiles(repoRoot) {
  const files = []
  for (const path of listRepositoryFiles(repoRoot)) {
    if (!isTestGateSourcePath(path)) {
      continue
    }
    try {
      files.push({ path, content: readFileSync(resolve(repoRoot, path), 'utf8') })
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw error
      }
    }
  }
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

function describeTotals(totals, skipTotal) {
  return (
    `single-platform gates ${totals.singlePlatformGates} ` +
    `(${totals.gatesInSuffixedFiles} in suffixed spec files, ${totals.gatesInHelpers} in helpers), ` +
    `focused tests ${totals.focused}, unconditional skips ${skipTotal}`
  )
}

export function runTestGatesCheck({
  repoRoot = DEFAULT_REPO_ROOT,
  stderr = process.stderr,
  stdout = null,
  updateRatchet = false,
  acceptRises = [],
  verbose = false,
} = {}) {
  const files = readTestGateFiles(repoRoot)
  if (files.length === 0) {
    stderr.write(`${LABEL} examined 0 test files: this is not a pass.\n`)
    return 1
  }
  const { findings, ignored, totals, counts } = evaluateTestGates(files)
  if (verbose) {
    for (const item of ignored) {
      stdout?.write(`${LABEL} ignored (cannot evaluate): ${item.file}:${item.line} ${item.text}\n`)
    }
  }
  const baselinePath = resolve(repoRoot, BASELINE_FILE)
  if (updateRatchet) {
    // A baseline written while a hard rule fails would freeze a tree that cannot pass anyway.
    if (findings.length > 0) {
      stderr.write(formatTestGateFindings(findings))
      return 1
    }
    const serialized = serializeTestGatesRatchet(counts)
    const guard = guardRatchetUpdate({
      root: repoRoot,
      path: BASELINE_FILE,
      next: serialized,
      acceptRises,
      hint: 'Run the test, fix it or delete it instead of skipping it.',
      label: 'test-gates-ratchet',
    })
    if (!guard.ok) {
      stderr.write(guard.text)
      return 1
    }
    writeFileSync(baselinePath, serialized)
    stdout?.write(guard.text)
    stdout?.write(
      `[test-gates-ratchet] wrote ${BASELINE_FILE}: unconditional-skip=${totalOf(counts['unconditional-skip'])}\n`,
    )
    return 0
  }
  const baseline = readBaseline(baselinePath)
  const issues = baseline === null ? [] : compareTestGatesRatchet(counts, baseline)
  let report = formatTestGateFindings(findings) + formatTestGatesRatchetIssues(issues)
  if (baseline === null) {
    report += `${LABEL} ${BASELINE_FILE} is missing. Run \`pnpm test-gates:ratchet\`.\n`
  }
  if (report !== '') {
    stderr.write(report)
    return 1
  }
  stdout?.write(
    `${LABEL} examined ${totals.files} test files: ${describeTotals(totals, totals.skips)}; counts match the baseline\n`,
  )
  return 0
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null
if (invokedPath === import.meta.url) {
  try {
    const { rules, rest } = parseAcceptRises(process.argv.slice(2))
    const unknown = rest.filter(arg => arg !== UPDATE_FLAG && arg !== VERBOSE_FLAG)
    if (unknown.length > 0) {
      process.stderr.write(
        `${LABEL} unsupported argument(s): ${unknown.join(' ')}. Only ${UPDATE_FLAG}, --accept-rise <rule> and ${VERBOSE_FLAG} are accepted; the baseline path is fixed.\n`,
      )
      process.exitCode = 2
    } else if (rules.length > 0 && !rest.includes(UPDATE_FLAG)) {
      process.stderr.write(`${LABEL} --accept-rise only applies together with ${UPDATE_FLAG}.\n`)
      process.exitCode = 2
    } else {
      process.exitCode = runTestGatesCheck({
        stdout: process.stdout,
        updateRatchet: rest.includes(UPDATE_FLAG),
        acceptRises: rules,
        verbose: rest.includes(VERBOSE_FLAG),
      })
    }
  } catch (error) {
    process.stderr.write(`${LABEL} ${error.message}\n`)
    process.exitCode = 2
  }
}
