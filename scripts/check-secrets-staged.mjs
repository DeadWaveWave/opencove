#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const PNPM_COMMAND = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'

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
  '.md',
  '.yml',
  '.yaml',
  '.env',
  '.sh',
  '.txt',
])

function shouldCheck(filePath) {
  if (
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

function isLikelyBinary(content) {
  return content.includes('\u0000')
}

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

const targetFiles = process.argv.length > 2 ? process.argv.slice(2) : resolveFilesFromStaged()
const files = targetFiles.filter(shouldCheck)

let hasErrors = false

for (const file of files) {
  let content
  try {
    content = readFileSync(file, 'utf8')
  } catch {
    continue
  }

  if (isLikelyBinary(content)) {
    continue
  }

  const result = spawnSync(PNPM_COMMAND, ['exec', 'secretlint', '--stdinFileName', file], {
    input: content,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  })

  if (result.stdout) {
    process.stdout.write(result.stdout)
  }

  if (result.stderr) {
    process.stderr.write(result.stderr)
  }

  if (result.status !== 0) {
    hasErrors = true
  }
}

process.exit(hasErrors ? 1 : 0)
