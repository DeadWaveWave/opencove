#!/usr/bin/env node
// `pnpm impact`: shows what a change touches before coding and before commit. Read-only.

import { resolveRepositoryRoot } from './lib/repo-files.mjs'
import { buildIndex, isShallowRepository, loadIndex, SHALLOW_HINT } from './lib/impact/cochange.mjs'
import {
  resolveBaseChanges,
  resolveExplicitChanges,
  resolveStagedChanges,
} from './lib/impact/changes.mjs'
import { formatPrSection } from './lib/impact/partner-section.mjs'
import { buildReport } from './lib/impact/report.mjs'
import { renderBrief, renderHuman } from './lib/impact/render.mjs'

const USAGE = `Usage: pnpm impact <files...> | --staged | --base <ref>  [--brief | --json | --pr-section] [--live]

  <files...>     planned or changed files (they need not exist yet)
  --staged       the staged change
  --base <ref>   the diff from the merge base with <ref>, plus uncommitted changes
  --brief        short summary (used by verify:quick)
  --json         machine-readable report (schemaVersion 1)
  --pr-section   the pull request section to paste: one line per missing partner
  --live         mine co-change from local history instead of the committed index (full clone)
`

function parseArguments(argv) {
  const options = {
    files: [],
    staged: false,
    base: null,
    brief: false,
    json: false,
    prSection: false,
    live: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--staged') {
      options.staged = true
    } else if (argument === '--base') {
      options.base = argv[(index += 1)] ?? null
      if (!options.base) {
        return null
      }
    } else if (argument === '--brief') {
      options.brief = true
    } else if (argument === '--json') {
      options.json = true
    } else if (argument === '--pr-section') {
      options.prSection = true
    } else if (argument === '--live') {
      options.live = true
    } else if (argument.startsWith('--')) {
      return null
    } else {
      options.files.push(argument)
    }
  }
  const modes = [options.files.length > 0, options.staged, options.base !== null].filter(Boolean)
  const formats = [options.brief, options.json, options.prSection].filter(Boolean)
  return modes.length === 1 && formats.length <= 1 ? options : null
}

const options = parseArguments(process.argv.slice(2))
if (!options) {
  process.stderr.write(USAGE)
  process.exit(2)
}

try {
  const root = resolveRepositoryRoot()
  let mode = 'explicit'
  let changes
  if (options.staged) {
    mode = 'staged'
    changes = resolveStagedChanges(root)
  } else if (options.base) {
    mode = 'base'
    changes = resolveBaseChanges(root, options.base)
  } else {
    changes = resolveExplicitChanges(root, options.files)
  }

  if (changes.length === 0) {
    process.stdout.write(`Impact: no ${mode === 'staged' ? 'staged' : 'changed'} files.\n`)
    process.exit(0)
  }

  let index
  if (options.live) {
    if (isShallowRepository(root)) {
      throw new Error(`--live needs full history. ${SHALLOW_HINT}`)
    }
    index = buildIndex(root)
  } else {
    index = loadIndex(root)
  }

  const report = await buildReport({
    root,
    input: { mode, base: options.base, changes },
    index,
    source: options.live ? 'live' : 'index',
  })

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  } else if (options.prSection) {
    process.stdout.write(formatPrSection(report.cochange.missing))
  } else {
    process.stdout.write(options.brief ? renderBrief(report) : renderHuman(report))
  }
} catch (error) {
  process.stderr.write(`impact: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
}
