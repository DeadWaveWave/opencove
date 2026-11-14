#!/usr/bin/env node

// Guard for tests that run less than they look like they run (issue #683). Two hard-zero rules and
// one ratchet, all over tracked `tests/**/*.ts(x)` and `src/**/*.spec.ts(x)`:
//
//   platform-gate-suffix  a test gated to one non-Linux platform lives in a file named for it
//                         (`*.windows.spec.ts`, `*.mac.spec.ts`), which that platform's CI job
//                         selects by glob
//   focused-test          no `test.only`, `it.only`, `describe.only` or `test.describe.only`
//
// The rules and the scanner are in `scripts/lib/test-gates.mjs`; the policy is in DEVELOPMENT.md.
//
//   --verbose   also list the conditions that mention a platform but could not be evaluated
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { listRepositoryFiles } from './lib/repo-files.mjs'
import {
  evaluateTestGates,
  formatTestGateFindings,
  isTestGateSourcePath,
} from './lib/test-gates.mjs'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const DEFAULT_REPO_ROOT = resolve(SCRIPT_DIR, '..')
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

export function runTestGatesCheck({
  repoRoot = DEFAULT_REPO_ROOT,
  stderr = process.stderr,
  stdout = null,
  verbose = false,
} = {}) {
  const files = readTestGateFiles(repoRoot)
  if (files.length === 0) {
    stderr.write(`${LABEL} examined 0 test files: this is not a pass.\n`)
    return 1
  }
  const { findings, ignored, totals } = evaluateTestGates(files)
  if (verbose) {
    for (const item of ignored) {
      stdout?.write(`${LABEL} ignored (cannot evaluate): ${item.file}:${item.line} ${item.text}\n`)
    }
  }
  if (findings.length > 0) {
    stderr.write(formatTestGateFindings(findings))
    return 1
  }
  stdout?.write(
    `${LABEL} examined ${totals.files} test files: single-platform gates ${totals.singlePlatformGates} ` +
      `(${totals.gatesInSuffixedFiles} in suffixed spec files, ${totals.gatesInHelpers} in helpers), ` +
      `focused tests ${totals.focused}\n`,
  )
  return 0
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null
if (invokedPath === import.meta.url) {
  try {
    const args = process.argv.slice(2)
    const unknown = args.filter(arg => arg !== '--verbose')
    if (unknown.length > 0) {
      process.stderr.write(
        `${LABEL} unsupported argument(s): ${unknown.join(' ')}. Only --verbose is accepted.\n`,
      )
      process.exitCode = 2
    } else {
      process.exitCode = runTestGatesCheck({
        stdout: process.stdout,
        verbose: args.includes('--verbose'),
      })
    }
  } catch (error) {
    process.stderr.write(`${LABEL} ${error.message}\n`)
    process.exitCode = 2
  }
}
