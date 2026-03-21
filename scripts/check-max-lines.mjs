#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const MAX_LINES = 500
const CHECKED_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.mts',
  '.cts',
  '.css',
  '.scss',
  '.less',
  '.json',
  '.md',
  '.yml',
  '.yaml',
  '.html',
])

function resolveFilesFromStaged() {
  const result = spawnSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], {
    encoding: 'utf8',
  })

  if (result.status !== 0) {
    if (result.stderr) {
      process.stderr.write(result.stderr)
    } else {
      process.stderr.write('Failed to list staged files.\n')
    }

    process.exit(1)
  }

  return result.stdout
    .split(/\r\n|\r|\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0)
}

const files = process.argv.length > 2 ? process.argv.slice(2) : resolveFilesFromStaged()

function shouldCheck(filePath) {
  if (
    filePath.includes('node_modules/') ||
    filePath.includes('dist/') ||
    filePath.includes('out/')
  ) {
    return false
  }

  // Lockfiles are generated and can be large; line limits are for authored sources.
  if (
    filePath === 'pnpm-lock.yaml' ||
    filePath === 'yarn.lock' ||
    filePath === 'package-lock.json' ||
    filePath === 'bun.lockb'
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

function countLines(content) {
  if (content.length === 0) {
    return 0
  }

  const parts = content.split(/\r\n|\r|\n/)
  // Ignore a trailing empty segment when the file ends with a newline.
  return parts.length > 0 && parts[parts.length - 1] === '' ? parts.length - 1 : parts.length
}

const violations = []

for (const file of files) {
  if (!shouldCheck(file)) {
    continue
  }

  let content
  try {
    content = readFileSync(file, 'utf8')
  } catch {
    continue
  }

  const lineCount = countLines(content)
  if (lineCount > MAX_LINES) {
    violations.push({ file, lineCount })
  }
}

if (violations.length === 0) {
  process.exit(0)
}

process.stderr.write(`Found files that exceed ${MAX_LINES} lines:\n`)
for (const violation of violations) {
  process.stderr.write(`- ${violation.file}: ${violation.lineCount} lines\n`)
}
process.stderr.write('Split these files before committing.\n')
process.exit(1)
