#!/usr/bin/env node
// Writes (or with --check, reproduces) the committed co-change index used by `pnpm impact`.
// Needs full history; refuses to run in a shallow clone. Depends only on Node and Git.

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { resolveRepositoryRoot } from './lib/repo-files.mjs'
import { buildIndex, checkIndex, INDEX_PATH, serializeIndex } from './lib/impact/cochange.mjs'

const USAGE = 'Usage: node scripts/impact-index.mjs [--check] [--through <ref>]\n'

function parseArguments(argv) {
  const options = { check: false, through: 'HEAD' }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--check') {
      options.check = true
    } else if (argument === '--through' && argv[index + 1]) {
      options.through = argv[(index += 1)]
    } else {
      return null
    }
  }
  return options
}

const options = parseArguments(process.argv.slice(2))
if (!options) {
  process.stderr.write(USAGE)
  process.exit(2)
}

try {
  const root = resolveRepositoryRoot()
  if (options.check) {
    const result = checkIndex(root)
    if (!result.ok) {
      process.stderr.write(
        `${INDEX_PATH} does not match the history up to ${result.throughCommit}.\n` +
          'The index is generated, never edited by hand. Regenerate it with `pnpm impact:index`.\n',
      )
      process.exit(1)
    }
    process.stdout.write(`${INDEX_PATH} reproduces from history up to ${result.throughCommit}.\n`)
  } else {
    const index = buildIndex(root, options.through)
    mkdirSync(dirname(join(root, INDEX_PATH)), { recursive: true })
    writeFileSync(join(root, INDEX_PATH), serializeIndex(index))
    process.stdout.write(
      `Wrote ${INDEX_PATH}: ${index.pairs.length} pairs, ${Object.keys(index.fileChanges).length} files, through ${index.throughCommit} (${index.throughDate}).\n`,
    )
  }
} catch (error) {
  process.stderr.write(`impact:index: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
}
