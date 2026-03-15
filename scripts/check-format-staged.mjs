#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import prettier from 'prettier'

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

function readStagedFile(filePath) {
  const result = spawnSync('git', ['show', `:${filePath}`], {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  })

  if (result.status !== 0) {
    if (result.stderr) {
      process.stderr.write(result.stderr)
    } else {
      process.stderr.write(`Failed to read staged file: ${filePath}\n`)
    }

    process.exit(1)
  }

  return result.stdout
}

function isLikelyBinary(content) {
  return content.includes('\u0000')
}

const files = resolveFilesFromStaged()

const results = await Promise.all(
  files.map(async file => {
    const fileInfo = await prettier.getFileInfo(file, {
      ignorePath: '.prettierignore',
    })

    if (fileInfo.ignored || fileInfo.inferredParser === null) {
      return { file, isFormatted: true }
    }

    const content = readStagedFile(file)
    if (isLikelyBinary(content)) {
      return { file, isFormatted: true }
    }

    const options = (await prettier.resolveConfig(file)) ?? {}
    const formatted = await prettier.format(content, {
      ...options,
      filepath: file,
    })

    return {
      file,
      isFormatted: formatted === content,
    }
  }),
)

const unformattedFiles = results.filter(result => result.isFormatted === false)

for (const result of unformattedFiles) {
  process.stderr.write(`[prettier] ${result.file} is not formatted.\n`)
}

process.exit(unformattedFiles.length > 0 ? 1 : 0)
