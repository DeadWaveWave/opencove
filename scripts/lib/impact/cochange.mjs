// Co-change index: which files historically change in the same commit. Depends only on Node and
// Git (no `typescript`), so CI can run it from a bare checkout. The committed index is a pure
// function of the Git history up to `throughCommit` and the parameters below.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const INDEX_PATH = 'scripts/impact-cochange-index.json'
export const INDEX_SCHEMA_VERSION = 1
export const INDEX_GENERATOR = 'scripts/impact-index.mjs'

// Build parameters, recorded in the index.
export const WINDOW_COMMITS = 500
export const MAX_COMMIT_FILES = 40
export const MIN_PAIR_SUPPORT = 5
export const INCLUDED_ROOTS = ['src/', 'scripts/', 'harness/', 'docs/']
export const EXCLUDED_DESCRIPTIONS = [
  '*.spec.*',
  '*.test.*',
  '**/*.css',
  'src/app/renderer/i18n/locales/**',
  '*.snap',
  'pnpm-lock.yaml',
  'CHANGELOG.md',
  'harness/**/results/**',
  INDEX_PATH,
]

// Query parameters: when a recorded pair is shown as a missing partner.
export const QUERY_MIN_SUPPORT = 5
export const QUERY_MIN_CONFIDENCE = 0.5
export const ALWAYS_TOGETHER_CONFIDENCE = 0.9
export const ALWAYS_TOGETHER_SUPPORT = 10
export const STALE_AFTER_DAYS = 45

const EXCLUDED_PATTERNS = [
  /\.(?:spec|test)\.[^/]+$/,
  /\.css$/,
  /^src\/app\/renderer\/i18n\/locales\//,
  /\.snap$/,
  /(?:^|\/)pnpm-lock\.yaml$/,
  /(?:^|\/)CHANGELOG\.md$/,
  /^harness\/(?:.*\/)?results\//,
]

export function isEligiblePath(path) {
  if (path === INDEX_PATH) {
    return false
  }
  if (!INCLUDED_ROOTS.some(prefix => path.startsWith(prefix))) {
    return false
  }
  return !EXCLUDED_PATTERNS.some(pattern => pattern.test(path))
}

function compareText(left, right) {
  if (left < right) {
    return -1
  }
  return left > right ? 1 : 0
}

/**
 * Pure miner. `commits` is newest first: `{ hash, entries: [{ status, path, oldPath? }] }`.
 * Renamed paths are mapped forward to their current name; `existingFiles` (a Set) limits the index
 * to paths present at the end of the history.
 */
export function buildIndexBody({
  commits,
  existingFiles = null,
  window = WINDOW_COMMITS,
  maxCommitFiles = MAX_COMMIT_FILES,
  minPairSupport = MIN_PAIR_SUPPORT,
}) {
  const forward = new Map()
  const resolve = path => forward.get(path) ?? path
  const fileCounts = new Map()
  const pairCounts = new Map()
  let eligible = 0

  for (const commit of commits) {
    if (eligible >= window) {
      break
    }
    const paths = new Set()
    for (const entry of commit.entries) {
      const current = resolve(entry.path)
      if (entry.status.startsWith('R') && entry.oldPath) {
        forward.set(entry.oldPath, current)
      }
      paths.add(current)
    }
    const files = [...paths].filter(isEligiblePath)
    if (files.length === 0 || files.length > maxCommitFiles) {
      continue
    }
    eligible += 1
    const kept = (existingFiles ? files.filter(file => existingFiles.has(file)) : files).sort(
      compareText,
    )
    for (let left = 0; left < kept.length; left += 1) {
      fileCounts.set(kept[left], (fileCounts.get(kept[left]) ?? 0) + 1)
      for (let right = left + 1; right < kept.length; right += 1) {
        const key = `${kept[left]}\0${kept[right]}`
        pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1)
      }
    }
  }

  const pairs = [...pairCounts]
    .filter(([, count]) => count >= minPairSupport)
    .map(([key, count]) => [...key.split('\0'), count])
    .sort((a, b) => compareText(a[0], b[0]) || compareText(a[1], b[1]))
  const fileChanges = {}
  for (const file of [...new Set(pairs.flatMap(([a, b]) => [a, b]))].sort(compareText)) {
    fileChanges[file] = fileCounts.get(file)
  }
  return { fileChanges, pairs }
}

export function buildIndexParams() {
  return {
    excluded: EXCLUDED_DESCRIPTIONS,
    included: INCLUDED_ROOTS,
    maxCommitFiles: MAX_COMMIT_FILES,
    minPairSupport: MIN_PAIR_SUPPORT,
    window: WINDOW_COMMITS,
  }
}

/** One entry per line, keys sorted, so the file diffs and reproduces byte for byte. */
export function serializeIndex(index) {
  const fileLines = Object.entries(index.fileChanges).map(
    ([file, count]) => `    ${JSON.stringify(file)}: ${count}`,
  )
  const pairLines = index.pairs.map(pair => `    ${JSON.stringify(pair)}`)
  const block = (open, close, lines) =>
    lines.length === 0 ? `${open}${close}` : `${open}\n${lines.join(',\n')}\n  ${close}`
  return `${[
    '{',
    `  "fileChanges": ${block('{', '}', fileLines)},`,
    `  "generatedBy": ${JSON.stringify(index.generatedBy)},`,
    `  "pairs": ${block('[', ']', pairLines)},`,
    `  "params": ${JSON.stringify(index.params)},`,
    `  "schemaVersion": ${index.schemaVersion},`,
    `  "throughCommit": ${JSON.stringify(index.throughCommit)},`,
    `  "throughDate": ${JSON.stringify(index.throughDate)}`,
    '}',
  ].join('\n')}\n`
}

function git(root, args) {
  const result = spawnSync('git', ['-c', 'core.quotepath=false', ...args], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
  })
  if (result.error || result.status !== 0) {
    throw new Error(
      `git ${args.join(' ')} failed: ${result.error?.message ?? result.stderr?.trim() ?? ''}`,
    )
  }
  return result.stdout
}

export function isShallowRepository(root) {
  return git(root, ['rev-parse', '--is-shallow-repository']).trim() === 'true'
}

export const SHALLOW_HINT =
  'This is a shallow clone, so its history is incomplete. Run `git fetch --unshallow` first.'

export function assertFullHistory(root) {
  if (isShallowRepository(root)) {
    throw new Error(SHALLOW_HINT)
  }
}

/** Parses `git log --name-status -M --format=%x01%H` output, newest first. */
export function parseGitLog(output) {
  const commits = []
  let current = null
  for (const line of output.split('\n')) {
    if (line.startsWith('\u0001')) {
      current = { hash: line.slice(1).trim(), entries: [] }
      commits.push(current)
    } else if (current && line.length > 0) {
      const [status, first, second] = line.split('\t')
      if (status.startsWith('R') || status.startsWith('C')) {
        current.entries.push({ status, oldPath: first, path: second })
      } else {
        current.entries.push({ status, path: first })
      }
    }
  }
  return commits
}

/** Builds the index for the history up to `through` (default HEAD). Needs a full clone. */
export function buildIndex(root, through = 'HEAD') {
  assertFullHistory(root)
  const throughCommit = git(root, ['rev-parse', '--verify', `${through}^{commit}`]).trim()
  const throughDate = git(root, ['show', '-s', '--format=%cs', throughCommit]).trim()
  const existingFiles = new Set(
    git(root, ['ls-tree', '-r', '--name-only', '-z', throughCommit])
      .split('\0')
      .filter(entry => entry.length > 0),
  )
  const commits = parseGitLog(
    git(root, ['log', throughCommit, '--no-merges', '-M', '--name-status', '--format=%x01%H']),
  )
  return {
    ...buildIndexBody({ commits, existingFiles }),
    generatedBy: INDEX_GENERATOR,
    params: buildIndexParams(),
    schemaVersion: INDEX_SCHEMA_VERSION,
    throughCommit,
    throughDate,
  }
}

export function readIndexText(root) {
  const path = join(root, INDEX_PATH)
  if (!existsSync(path)) {
    throw new Error(`${INDEX_PATH} is missing. Run \`pnpm impact:index\` on a full clone.`)
  }
  return readFileSync(path, 'utf8')
}

export function parseIndex(text) {
  const index = JSON.parse(text)
  if (index?.schemaVersion !== INDEX_SCHEMA_VERSION) {
    throw new Error(
      `${INDEX_PATH} has schemaVersion ${index?.schemaVersion}; expected ${INDEX_SCHEMA_VERSION}. Run \`pnpm impact:index\`.`,
    )
  }
  return index
}

export function loadIndex(root) {
  return parseIndex(readIndexText(root))
}

/** Rebuilds the index from history up to its recorded `throughCommit` and compares the bytes. */
export function checkIndex(root) {
  const recorded = readIndexText(root)
  const { throughCommit } = parseIndex(recorded)
  const rebuilt = serializeIndex(buildIndex(root, throughCommit))
  return { ok: rebuilt === recorded, throughCommit, rebuilt, recorded }
}

function roundConfidence(value) {
  return Math.round(value * 1000) / 1000
}

function pairsByFile(index) {
  const byFile = new Map()
  const add = (file, partner, together) => {
    const list = byFile.get(file) ?? []
    list.push({ partner, together })
    byFile.set(file, list)
  }
  for (const [left, right, together] of index.pairs) {
    add(left, right, together)
    add(right, left, together)
  }
  return byFile
}

/**
 * The partners a change leaves untouched. One function serves `pnpm impact` and the pull request
 * check, so both always list the same partners. `files` are every path the change touches.
 */
export function findMissingPartners(index, files, { exists = () => true } = {}) {
  const changed = new Set(files)
  const byFile = pairsByFile(index)
  const missing = []
  const noHistory = []
  const stale = new Set()

  for (const file of [...changed].sort(compareText)) {
    const fileChanges = index.fileChanges[file]
    if (!fileChanges) {
      noHistory.push(file)
      continue
    }
    for (const { partner, together } of byFile.get(file) ?? []) {
      if (changed.has(partner) || together < QUERY_MIN_SUPPORT) {
        continue
      }
      if (together < fileChanges * QUERY_MIN_CONFIDENCE) {
        continue
      }
      if (!exists(partner)) {
        stale.add(partner)
        continue
      }
      missing.push({
        file,
        partner,
        together,
        fileChanges,
        confidence: roundConfidence(together / fileChanges),
        alwaysTogether:
          together >= ALWAYS_TOGETHER_SUPPORT &&
          together >= fileChanges * ALWAYS_TOGETHER_CONFIDENCE,
      })
    }
  }

  missing.sort(
    (a, b) =>
      compareText(a.file, b.file) ||
      b.confidence - a.confidence ||
      b.together - a.together ||
      compareText(a.partner, b.partner),
  )
  return { missing, noHistory, droppedStalePaths: [...stale].sort(compareText) }
}

export function indexAgeDays(index, now = new Date()) {
  const through = Date.parse(`${index.throughDate}T00:00:00Z`)
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return Math.max(0, Math.floor((today - through) / 86_400_000))
}
