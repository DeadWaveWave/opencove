#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  DEAD_CODE_LABEL,
  RATCHET_FILE,
  classifyKnipReport,
  compareDeadCodeRatchet,
  findInternalNamingViolations,
  formatDeadCodeReport,
  formatRaisedCounts,
  raisedCounts,
  serializeDeadCodeRatchet,
} from './lib/dead-code.mjs'

const DEFAULT_REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE_PATTERN = /\.(ts|tsx|mjs|cjs)$/

function listSourceFiles(root, directory = 'src') {
  const files = []
  for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`
    if (entry.isDirectory()) {
      files.push(...listSourceFiles(root, path))
    } else if (SOURCE_PATTERN.test(entry.name)) {
      files.push(path)
    }
  }
  return files
}

/** Run the pinned local knip in production mode and return its parsed JSON report. */
export function runKnip(root) {
  const knipBin = resolve(root, 'node_modules/knip/bin/knip.js')
  const result = spawnSync(
    process.execPath,
    [knipBin, '--production', '--reporter', 'json', '--no-exit-code'],
    { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
  )
  try {
    return JSON.parse(result.stdout)
  } catch {
    throw new Error(
      `[${DEAD_CODE_LABEL}] knip produced no JSON report (exit ${result.status}).\n` +
        `${result.stderr || result.stdout}`,
    )
  }
}

function readBaseline(path) {
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null
}

export function runDeadCodeCheck({
  root = DEFAULT_REPO_ROOT,
  updateRatchet = false,
  report = runKnip(root),
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  const ratchetPath = resolve(root, RATCHET_FILE)
  const { findings, counts } = classifyKnipReport(report)
  const baseline = readBaseline(ratchetPath)
  const internalViolations = findInternalNamingViolations(
    listSourceFiles(root).map(file => ({
      file,
      text: readFileSync(resolve(root, file), 'utf8'),
    })),
  )

  if (updateRatchet) {
    // A missing baseline is the one-time bootstrap; afterwards counts may only fall.
    const raised = baseline ? raisedCounts(counts, baseline) : []
    if (raised.length > 0) {
      stderr.write(formatRaisedCounts(raised))
      return 1
    }
    writeFileSync(ratchetPath, serializeDeadCodeRatchet(counts))
    stdout.write(`[${DEAD_CODE_LABEL}] wrote ${relative(root, ratchetPath)}\n`)
    return findings.length + internalViolations.length > 0 ? 1 : 0
  }

  const ratchetIssues = compareDeadCodeRatchet(counts, baseline)
  if (findings.length + internalViolations.length + ratchetIssues.length === 0) {
    return 0
  }
  stderr.write(formatDeadCodeReport({ findings, ratchetIssues, internalViolations }))
  return 1
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null
if (invokedPath === import.meta.url) {
  process.exitCode = runDeadCodeCheck({ updateRatchet: process.argv.includes('--update-ratchet') })
}
