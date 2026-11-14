#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  isExcludedRepositoryPath,
  listRepositoryFiles,
  normalizeRepositoryPath,
  resolveRepositoryRoot,
} from './lib/repo-files.mjs'

// A file should fit in one read by the agents that work on this repository. The smallest such
// window is about 10,000 tokens of command output, roughly 1000 lines of this code base.
export const MAX_LINES = 1000

// Hand-written code only. Prose and data (`.md`, `.json`, `.jsonl`, `.yml`, `.html`) are read in
// pieces or by tools, and are not limited.
export const CHECKED_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.css',
  '.scss',
  '.less',
  '.sh',
  '.ps1',
  '.cmd',
  '.cs',
])

// Generated files grow with their inputs and cannot be split by hand; their generators are checked
// like any other source. Each entry is a path prefix and names the command that writes it. A file
// is never skipped because of how it is named: add its path here together with its generator.
export const GENERATED_PATHS = [
  // `pnpm design:tokens`
  'src/app/renderer/styles/themes/generated/',
  // `node scripts/generate-claude-command-registry.mjs`
  'src/shared/utils/claudeRootCommands.generated.ts',
]

// Files that are over the limit today. Each recorded count may only go down, and the list may only
// shrink: an exempt file fails when its count differs from the record, when it is back under the
// limit, or when it no longer exists.
export const LINE_LIMIT_EXEMPTIONS = {
  'scripts/recover-opencove-db-from-sqlite-recover.mjs': {
    lines: 1128,
    reason: 'recovery tool; split tracked in follow-up',
  },
  'scripts/debug-repro-restored-agent-input.mjs': {
    lines: 1050,
    reason: 'debug repro script; split tracked in follow-up',
  },
}

export function shouldCheck(filePath) {
  const normalized = normalizeRepositoryPath(filePath)
  if (isExcludedRepositoryPath(normalized)) {
    return false
  }

  const fileName = normalized.slice(normalized.lastIndexOf('/') + 1)
  if (GENERATED_PATHS.some(prefix => normalized.startsWith(prefix))) {
    return false
  }

  const dotIndex = fileName.lastIndexOf('.')
  if (dotIndex === -1) {
    return false
  }

  return CHECKED_EXTENSIONS.has(fileName.slice(dotIndex).toLowerCase())
}

export function countLines(content) {
  if (content.length === 0) {
    return 0
  }

  const parts = content.split(/\r\n|\r|\n/)
  // Ignore a trailing empty segment when the file ends with a newline.
  return parts.length > 0 && parts[parts.length - 1] === '' ? parts.length - 1 : parts.length
}

function readLineCount(cwd, file) {
  try {
    return countLines(readFileSync(resolve(cwd, file), 'utf8'))
  } catch {
    return null
  }
}

// Returns `{ checked, problems }`. `cwd` is the repository root and `files` are root-relative; with
// `files` undefined it checks the whole repository. Exemption rules apply in both modes; only the
// "exempt file no longer exists" check needs the whole repository.
export function runMaxLinesCheck({
  cwd = process.cwd(),
  files,
  exemptions = LINE_LIMIT_EXEMPTIONS,
} = {}) {
  const wholeRepository = files === undefined
  const candidates = (wholeRepository ? listRepositoryFiles(cwd) : files).map(
    normalizeRepositoryPath,
  )
  const problems = []
  const counts = new Map()

  for (const file of candidates) {
    if (!shouldCheck(file)) {
      continue
    }
    const lineCount = readLineCount(cwd, file)
    if (lineCount !== null) {
      counts.set(file, lineCount)
    }
  }

  for (const [file, lineCount] of counts) {
    const exemption = exemptions[file]
    if (!exemption) {
      if (lineCount > MAX_LINES) {
        problems.push(
          `${file}: ${lineCount} lines (limit ${MAX_LINES}). Split it before committing.`,
        )
      }
      continue
    }
    if (lineCount <= MAX_LINES) {
      problems.push(
        `${file}: ${lineCount} lines is back under the ${MAX_LINES}-line limit. Remove it from LINE_LIMIT_EXEMPTIONS in scripts/check-max-lines.mjs.`,
      )
    } else if (lineCount > exemption.lines) {
      problems.push(
        `${file}: ${lineCount} lines exceeds its recorded ${exemption.lines} (exempt: ${exemption.reason}). Exempt files may only shrink; split it.`,
      )
    } else if (lineCount < exemption.lines) {
      problems.push(
        `${file}: ${lineCount} lines is below its recorded ${exemption.lines}. Record ${lineCount} in LINE_LIMIT_EXEMPTIONS in scripts/check-max-lines.mjs.`,
      )
    }
  }

  if (wholeRepository) {
    for (const file of Object.keys(exemptions)) {
      if (!counts.has(file)) {
        problems.push(
          `${file}: listed in LINE_LIMIT_EXEMPTIONS but no longer exists. Remove the entry in scripts/check-max-lines.mjs.`,
        )
      }
    }
  }

  return { checked: counts.size, problems }
}

function main() {
  const root = resolveRepositoryRoot()
  const files =
    process.argv.length > 2
      ? process.argv.slice(2).map(argument => relative(root, resolve(argument)))
      : undefined
  const { checked, problems } = runMaxLinesCheck({ cwd: root, files })

  if (checked === 0) {
    process.stderr.write('[line-check] checked 0 files: this is not a pass.\n')
    return 1
  }

  if (problems.length > 0) {
    process.stderr.write(`[line-check] Line limit violations (${MAX_LINES} lines per file):\n`)
    for (const problem of problems) {
      process.stderr.write(`- ${problem}\n`)
    }
    return 1
  }

  process.stdout.write(`[line-check] checked ${checked} files, all within ${MAX_LINES} lines\n`)
  return 0
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null
if (invokedPath === import.meta.url) {
  process.exitCode = main()
}
