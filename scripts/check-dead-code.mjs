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
  serializeDeadCodeRatchet,
} from './lib/dead-code.mjs'
import { guardRatchetUpdate, parseAcceptRises } from './lib/ratchet-git.mjs'

const DEFAULT_REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE_PATTERN = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/

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
  acceptRises = [],
  report = runKnip(root),
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  const ratchetPath = resolve(root, RATCHET_FILE)
  const { findings, counts, names } = classifyKnipReport(report)
  const sourceFiles = listSourceFiles(root)
  const internalViolations = findInternalNamingViolations(
    sourceFiles.map(file => ({
      file,
      text: readFileSync(resolve(root, file), 'utf8'),
    })),
  )

  if (updateRatchet) {
    // An empty scan has no unused exports to record; it is a broken scan, not a clean tree.
    if (sourceFiles.length === 0) {
      stderr.write(`[${DEAD_CODE_LABEL}] found 0 source files: refusing to write the baseline.\n`)
      return 1
    }
    const serialized = serializeDeadCodeRatchet(counts)
    const guard = guardRatchetUpdate({
      root,
      path: RATCHET_FILE,
      next: serialized,
      acceptRises,
      hint: 'Delete the new unused exports and types instead of recording them.',
      label: DEAD_CODE_LABEL,
    })
    if (!guard.ok) {
      stderr.write(guard.text)
      return 1
    }
    writeFileSync(ratchetPath, serialized)
    stdout.write(guard.text)
    stdout.write(`[${DEAD_CODE_LABEL}] wrote ${relative(root, ratchetPath)}\n`)
    return findings.length + internalViolations.length > 0 ? 1 : 0
  }

  const ratchetIssues = compareDeadCodeRatchet(counts, readBaseline(ratchetPath), names)
  if (findings.length + internalViolations.length + ratchetIssues.length === 0) {
    return 0
  }
  stderr.write(formatDeadCodeReport({ findings, ratchetIssues, internalViolations }))
  return 1
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null
if (invokedPath === import.meta.url) {
  try {
    const { rules, rest } = parseAcceptRises(process.argv.slice(2))
    const updateRatchet = rest.includes('--update-ratchet')
    if (rules.length > 0 && !updateRatchet) {
      throw new Error('--accept-rise only applies together with --update-ratchet.')
    }
    process.exitCode = runDeadCodeCheck({ updateRatchet, acceptRises: rules })
  } catch (error) {
    process.stderr.write(`[${DEAD_CODE_LABEL}] ${error.message}\n`)
    process.exitCode = 2
  }
}
