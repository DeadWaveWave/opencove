import { median } from './e2e-report.mjs'

const comparePath = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

function caseFiles(ids) {
  if (!ids.length) {
    throw new Error('Cannot plan an empty E2E inventory.')
  }
  if (new Set(ids).size !== ids.length) {
    throw new Error('Duplicate E2E case ID.')
  }
  return ids.map(id => {
    const [file, title] = id.split(' › ')
    if (!file.startsWith('tests/e2e/') || !file.endsWith('.spec.ts') || !title) {
      throw new Error(`Invalid E2E case ID: ${id}`)
    }
    return file
  })
}

export function validatePlan(ids, shards, shardCount) {
  if (shards.length !== shardCount) {
    throw new Error('E2E shard count mismatch.')
  }
  const expected = new Set(caseFiles(ids))
  const seen = new Set()
  for (const shard of shards) {
    for (const file of shard.files) {
      if (!expected.has(file)) {
        throw new Error(`Unexpected E2E file in plan: ${file}`)
      }
      if (seen.has(file)) {
        throw new Error(`Duplicate E2E file in plan: ${file}`)
      }
      seen.add(file)
    }
  }
  const missing = [...expected].filter(file => !seen.has(file))
  if (missing.length) {
    throw new Error(`E2E shard plan missing files: ${missing.join(', ')}`)
  }
  if (shards.filter(shard => shard.files.length).length !== Math.min(expected.size, shardCount)) {
    throw new Error('E2E shard plan has an unexpected empty shard.')
  }
}

export function planShards(ids, baseline, shardCount) {
  if (!Number.isSafeInteger(shardCount) || shardCount < 1) {
    throw new Error('E2E shard count must be a positive integer.')
  }
  const orderedIds = [...ids].sort(comparePath)
  const paths = caseFiles(orderedIds)
  const samples = Object.values(baseline)
  if (samples.some(ms => !Number.isFinite(ms) || ms < 0)) {
    throw new Error('Invalid E2E baseline duration; expected non-negative milliseconds.')
  }
  // Zero is explicit not-run evidence, never an estimate for a missing observation.
  // The initial baselines contain only passed timings, so absence remains unknown.
  const positive = samples.filter(ms => ms > 0)
  const defaultMs = positive.length ? median(positive) : 10000
  const files = new Map()
  let unknownCases = 0
  for (const [index, id] of orderedIds.entries()) {
    const known = Object.hasOwn(baseline, id)
    if (!known) {
      unknownCases++
    }
    const file = paths[index]
    files.set(file, (files.get(file) ?? 0) + (known ? baseline[id] : defaultMs))
  }
  const shards = Array.from({ length: shardCount }, (_, index) => ({
    shard: index + 1,
    files: [],
    estimatedMs: 0,
  }))
  const longestFirst = [...files].sort((a, b) => b[1] - a[1] || comparePath(a[0], b[0]))
  for (const [file, estimatedMs] of longestFirst) {
    // File count breaks zero-cost ties so skipped-only inventories cannot leave holes.
    const lightest = [...shards].sort(
      (a, b) =>
        a.estimatedMs - b.estimatedMs || a.files.length - b.files.length || a.shard - b.shard,
    )[0]
    lightest.files.push(file)
    lightest.estimatedMs += estimatedMs
    if (!Number.isFinite(lightest.estimatedMs)) {
      throw new Error('E2E duration total overflow.')
    }
  }
  for (const shard of shards) {
    shard.files.sort(comparePath)
  }
  validatePlan(ids, shards, shardCount)
  return { defaultMs, unknownCases, caseCount: ids.length, fileCount: files.size, shards }
}

// Playwright positional arguments are regexes, not literal filenames.
export function fileFilter(file) {
  return `(^|/)${file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`
}
