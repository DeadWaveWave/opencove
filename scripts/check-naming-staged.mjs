#!/usr/bin/env node

import { spawnSync } from 'node:child_process'

const CHECKED_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.mts',
  '.cts',
  '.json',
  '.yml',
  '.yaml',
])

function shouldCheck(filePath) {
  if (
    filePath.startsWith('scripts/') ||
    filePath.includes('node_modules/') ||
    filePath.includes('dist/') ||
    filePath.includes('out/')
  ) {
    return false
  }

  const dotIndex = filePath.lastIndexOf('.')
  if (dotIndex === -1) {
    return false
  }

  const extension = filePath.slice(dotIndex).toLowerCase()
  return CHECKED_EXTENSIONS.has(extension)
}

function resolveStagedDiff() {
  const result = spawnSync('git', ['diff', '--cached', '-U0', '--diff-filter=ACMR'], {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  })

  if (result.status !== 0) {
    if (result.stderr) {
      process.stderr.write(result.stderr)
    } else {
      process.stderr.write('Failed to read staged diff.\n')
    }
    process.exit(1)
  }

  return result.stdout
}

function isExplicitLegacyLine(line) {
  return /\blegacy\b/i.test(line) || /\bLEGACY_/i.test(line)
}

function includesLegacyStoragePrefix(line) {
  // `opencove:*` contains the substring `cove:*`, so we must guard on a word boundary-like separator.
  return /(^|[^a-zA-Z0-9_])cove:m0:/i.test(line)
}

function includesCoveProtocolPrefix(line) {
  // `opencove:*` contains the substring `cove:*`, so we must guard on a word boundary-like separator.
  return /(^|[^a-zA-Z0-9_])cove:/i.test(line)
}

function includesCoveTestPrefix(line) {
  // `opencove-test-*` contains the substring `cove-test-*`, so we must guard on a word boundary-like separator.
  return /(^|[^a-zA-Z0-9_])cove-test-/i.test(line)
}

function includesCoveDbFileName(line) {
  // `opencove.db` contains the substring `cove.db`, so we must guard on a word boundary-like separator.
  return /(^|[^a-zA-Z0-9_])cove\.db\b/i.test(line)
}

function includesCoveApiToken(line) {
  // `opencoveApi` contains the substring `coveApi`, but without a word boundary before `c`.
  return /\bcoveApi\b/.test(line)
}

function includesCoveLogPrefix(line) {
  return /\[cove\]/.test(line)
}

const targetFiles = process.argv.length > 2 ? new Set(process.argv.slice(2)) : null

const diff = resolveStagedDiff()
const lines = diff.split(/\r\n|\r|\n/)

const violations = []
let currentFile = null

for (const rawLine of lines) {
  if (rawLine.startsWith('+++ b/')) {
    currentFile = rawLine.slice('+++ b/'.length).trim()
    continue
  }

  if (!currentFile || !shouldCheck(currentFile)) {
    continue
  }

  if (targetFiles && !targetFiles.has(currentFile)) {
    continue
  }

  if (rawLine.startsWith('+++')) {
    continue
  }

  if (!rawLine.startsWith('+')) {
    continue
  }

  const addedLine = rawLine.slice(1)

  if (includesCoveApiToken(addedLine)) {
    violations.push({
      file: currentFile,
      rule: 'coveApi',
      hint: 'Use `opencoveApi` (global API) instead of `coveApi`.',
      line: addedLine.trimEnd(),
    })
  }

  if (includesCoveLogPrefix(addedLine)) {
    violations.push({
      file: currentFile,
      rule: '[cove] log prefix',
      hint: 'Use `[opencove]` for log prefixes.',
      line: addedLine.trimEnd(),
    })
  }

  if (includesCoveTestPrefix(addedLine)) {
    violations.push({
      file: currentFile,
      rule: 'cove-test-*',
      hint: 'Use `opencove-test-*` for test identifiers/prefixes.',
      line: addedLine.trimEnd(),
    })
  }

  if (includesCoveDbFileName(addedLine)) {
    violations.push({
      file: currentFile,
      rule: 'cove.db',
      hint: 'Use `opencove.db` as the persisted database filename.',
      line: addedLine.trimEnd(),
    })
  }

  if (includesLegacyStoragePrefix(addedLine)) {
    if (!isExplicitLegacyLine(addedLine)) {
      violations.push({
        file: currentFile,
        rule: 'cove:m0:*',
        hint: 'Use `opencove:m0:*` for new keys. If this is an intentional legacy migration path, add `LEGACY_` or comment `legacy` on the same line.',
        line: addedLine.trimEnd(),
      })
    }

    continue
  }

  if (includesCoveProtocolPrefix(addedLine)) {
    violations.push({
      file: currentFile,
      rule: 'cove:* prefix',
      hint: 'Use `opencove:*` (event/protocol/key prefix) instead of `cove:*`.',
      line: addedLine.trimEnd(),
    })
  }
}

if (violations.length === 0) {
  process.exit(0)
}

process.stderr.write(
  '[naming-check] Disallowed `cove`-prefixed tokens found in staged additions:\n',
)
for (const violation of violations) {
  process.stderr.write(`- ${violation.file} (${violation.rule})\n`)
  process.stderr.write(`  ${violation.hint}\n`)
  process.stderr.write(`  + ${violation.line}\n`)
}
process.stderr.write('\nSee DEVELOPMENT.md "命名与前缀 (Naming)" for the enforced conventions.\n')
process.exit(1)
