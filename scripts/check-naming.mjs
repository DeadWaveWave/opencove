#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import {
  isExcludedRepositoryPath,
  listRepositoryFiles,
  normalizeRepositoryPath,
  resolveRepositoryRoot,
} from './lib/repo-files.mjs'

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
  if (filePath.startsWith('scripts/') || isExcludedRepositoryPath(filePath)) {
    return false
  }

  const dotIndex = filePath.lastIndexOf('.')
  if (dotIndex === -1) {
    return false
  }

  const extension = filePath.slice(dotIndex).toLowerCase()
  return CHECKED_EXTENSIONS.has(extension)
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

const root = resolveRepositoryRoot()
const targetFiles =
  process.argv.length > 2
    ? process.argv
        .slice(2)
        .map(argument => normalizeRepositoryPath(relative(root, resolve(argument))))
    : null
const files = (targetFiles ?? listRepositoryFiles(root)).filter(shouldCheck)

const violations = []
let checkedFileCount = 0

for (const currentFile of files) {
  let content
  try {
    content = readFileSync(resolve(root, currentFile), 'utf8')
  } catch {
    continue
  }
  checkedFileCount += 1

  for (const [index, addedLine] of content.split(/\r\n|\r|\n/).entries()) {
    const location = `${currentFile}:${index + 1}`
    if (includesCoveApiToken(addedLine)) {
      violations.push({
        file: location,
        rule: 'coveApi',
        hint: 'Use `opencoveApi` (global API) instead of `coveApi`.',
        line: addedLine.trimEnd(),
      })
    }

    if (includesCoveLogPrefix(addedLine)) {
      violations.push({
        file: location,
        rule: '[cove] log prefix',
        hint: 'Use `[opencove]` for log prefixes.',
        line: addedLine.trimEnd(),
      })
    }

    if (includesCoveTestPrefix(addedLine)) {
      violations.push({
        file: location,
        rule: 'cove-test-*',
        hint: 'Use `opencove-test-*` for test identifiers/prefixes.',
        line: addedLine.trimEnd(),
      })
    }

    if (includesCoveDbFileName(addedLine)) {
      violations.push({
        file: location,
        rule: 'cove.db',
        hint: 'Use `opencove.db` as the persisted database filename.',
        line: addedLine.trimEnd(),
      })
    }

    if (includesLegacyStoragePrefix(addedLine)) {
      // The prefix is compatibility code: `pnpm compat:check` owns it and requires a registry entry.
      continue
    }

    if (includesCoveProtocolPrefix(addedLine)) {
      violations.push({
        file: location,
        rule: 'cove:* prefix',
        hint: 'Use `opencove:*` (event/protocol/key prefix) instead of `cove:*`.',
        line: addedLine.trimEnd(),
      })
    }
  }
}

if (checkedFileCount === 0) {
  process.stderr.write('[naming-check] scanned 0 files: this is not a pass.\n')
  process.exit(1)
}

if (violations.length === 0) {
  process.stdout.write(`[naming-check] scanned ${checkedFileCount} files, no violations\n`)
  process.exit(0)
}

process.stderr.write('[naming-check] Disallowed `cove`-prefixed tokens found:\n')
for (const violation of violations) {
  process.stderr.write(`- ${violation.file} (${violation.rule})\n`)
  process.stderr.write(`  ${violation.hint}\n`)
  process.stderr.write(`  ${violation.line}\n`)
}
process.stderr.write('\nSee DEVELOPMENT.md "命名与前缀 (Naming)" for the enforced conventions.\n')
process.exit(1)
