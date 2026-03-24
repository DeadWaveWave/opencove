#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { resolve } from 'node:path'

const rootDir = resolve(import.meta.dirname, '..')
const packageJsonPath = resolve(rootDir, 'package.json')
const stableSourceDir = resolve(rootDir, 'build', 'release-notes', 'stable')
const nightlyOverrideDir = resolve(rootDir, 'build', 'release-notes', 'nightly')
const outputDir = resolve(rootDir, 'release')
const outputPath = resolve(outputDir, 'release-manifest.json')
const OWNER = 'DeadWaveWave'
const REPO = 'opencove'
const MAX_ITEMS = 12

function normalizeVersionTag(version) {
  const normalized = version.trim()
  return normalized.startsWith('v') ? normalized : `v${normalized}`
}

function buildCompareUrl(fromTag, toTag) {
  return `https://github.com/${OWNER}/${REPO}/compare/${encodeURIComponent(
    fromTag,
  )}...${encodeURIComponent(toTag)}`
}

function buildReleaseUrl(version) {
  return `https://github.com/${OWNER}/${REPO}/releases/tag/${encodeURIComponent(
    normalizeVersionTag(version),
  )}`
}

function isNightlyVersion(version) {
  return version.includes('-nightly.')
}

function normalizeNullableText(value) {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function ensureManifest(value) {
  if (!value || typeof value !== 'object') {
    throw new Error('release notes manifest must be an object')
  }

  const record = value
  if (record.schemaVersion !== 1) {
    throw new Error('release notes manifest schemaVersion must be 1')
  }

  const version = normalizeNullableText(record.version)
  const publishedAt = normalizeNullableText(record.publishedAt)
  const defaultLocale = normalizeNullableText(record.defaultLocale)
  const channel = normalizeNullableText(record.channel)
  const provenance = normalizeNullableText(record.provenance)
  if (
    version === null ||
    publishedAt === null ||
    defaultLocale === null ||
    channel === null ||
    provenance === null ||
    (channel !== 'stable' && channel !== 'nightly') ||
    (provenance !== 'curated' && provenance !== 'generated')
  ) {
    throw new Error('release notes manifest is missing required fields')
  }

  const locales = record.locales
  if (!locales || typeof locales !== 'object' || Object.keys(locales).length === 0) {
    throw new Error('release notes manifest must define at least one locale')
  }

  return record
}

async function pathExists(path) {
  try {
    await access(path, fsConstants.R_OK)
    return true
  } catch {
    return false
  }
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

function parsePrNumberFromMergeTitle(line) {
  const match = /^Merge pull request #(\d+)\b/.exec(line)
  return match ? Number(match[1]) : null
}

function parsePrNumberFromSuffix(line) {
  const match = /\(#(\d+)\)\s*$/.exec(line)
  return match ? Number(match[1]) : null
}

function stripPrNumberSuffix(line) {
  return line.replace(/\s*\(#\d+\)\s*$/, '').trim()
}

function pickCommitSummary(message) {
  const lines = message
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)

  if (lines.length === 0) {
    return { summary: '', prNumber: null }
  }

  const mergePrNumber = parsePrNumberFromMergeTitle(lines[0])
  if (mergePrNumber !== null) {
    return {
      summary: lines.length > 1 ? lines[1] : lines[0],
      prNumber: mergePrNumber,
    }
  }

  const prNumber = parsePrNumberFromSuffix(lines[0])
  return {
    summary: prNumber === null ? lines[0] : stripPrNumberSuffix(lines[0]),
    prNumber,
  }
}

function normalizeKindAndSummary(summary) {
  const match = /^([a-zA-Z]+)(!)?(?:\([^)]+\))?:\s+(.+)$/.exec(summary)
  const type = match?.[1]?.toLowerCase() ?? null
  const rest = match?.[3]?.trim() ?? ''

  if (type === 'feat') {
    return { kind: 'added', summary: rest.length > 0 ? rest : summary }
  }

  if (type === 'fix') {
    return { kind: 'fixed', summary: rest.length > 0 ? rest : summary }
  }

  if (type === 'docs') {
    return { kind: 'docs', summary: rest.length > 0 ? rest : summary }
  }

  if (type === 'refactor' || type === 'perf' || type === 'style') {
    return { kind: 'changed', summary: rest.length > 0 ? rest : summary }
  }

  return { kind: 'other', summary }
}

function readGit(args) {
  return execFileSync('git', args, {
    cwd: rootDir,
    encoding: 'utf8',
  }).trim()
}

function hasGitTag(tagName) {
  return readGit(['tag', '--list', tagName]).split(/\r?\n/).includes(tagName)
}

function resolvePreviousNightlyTag(currentTag) {
  const tags = readGit(['tag', '--sort=-creatordate'])
    .split(/\r?\n/)
    .map(tag => tag.trim())
    .filter(Boolean)

  const currentIndex = tags.indexOf(currentTag)
  if (currentIndex < 0) {
    return tags.find(tag => tag.includes('-nightly.')) ?? null
  }

  for (let index = currentIndex + 1; index < tags.length; index += 1) {
    if (tags[index].includes('-nightly.')) {
      return tags[index]
    }
  }

  return null
}

function buildItemUrl(prNumber, sha) {
  if (prNumber !== null) {
    return `https://github.com/${OWNER}/${REPO}/pull/${prNumber}`
  }

  return sha ? `https://github.com/${OWNER}/${REPO}/commit/${sha}` : null
}

function collectNightlyItems(previousTag, currentTag) {
  if (!previousTag) {
    return []
  }

  const raw = readGit(['log', '--format=%H%x1f%s%x1f%b%x1e', `${previousTag}..${currentTag}`])
  const entries = raw
    .split('\x1e')
    .map(chunk => chunk.trim())
    .filter(Boolean)

  const items = []
  const seen = new Set()

  for (const entry of entries) {
    if (items.length >= MAX_ITEMS) {
      break
    }

    const [sha = '', subject = '', body = ''] = entry.split('\x1f')
    const { summary, prNumber } = pickCommitSummary([subject, body].filter(Boolean).join('\n'))
    const normalizedSummary = summary.trim()
    if (normalizedSummary.length === 0) {
      continue
    }

    const normalized = normalizeKindAndSummary(normalizedSummary)
    const key = `${prNumber ?? ''}:${normalized.kind}:${normalized.summary}`
    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    items.push({
      kind: normalized.kind,
      summary: normalized.summary,
      url: buildItemUrl(prNumber, sha || null),
      prNumber,
      sha: sha || null,
    })
  }

  return items
}

function buildNightlySummary(itemCount) {
  if (itemCount === 0) {
    return 'Nightly preview build with the latest OpenCove changes.'
  }

  return `Nightly preview build covering ${itemCount} recent user-facing changes.`
}

async function loadStableManifest(version) {
  const sourcePath = resolve(stableSourceDir, `${normalizeVersionTag(version)}.json`)
  if (!(await pathExists(sourcePath))) {
    throw new Error(`Missing curated stable release notes: ${sourcePath}`)
  }

  return ensureManifest(await readJson(sourcePath))
}

async function loadNightlyOverride(version) {
  const overridePath = resolve(nightlyOverrideDir, `${normalizeVersionTag(version)}.json`)
  if (!(await pathExists(overridePath))) {
    return null
  }

  return ensureManifest(await readJson(overridePath))
}

async function buildNightlyManifest(version) {
  const override = await loadNightlyOverride(version)
  if (override) {
    return override
  }

  const currentTag = normalizeVersionTag(version)
  const previousTag = resolvePreviousNightlyTag(currentTag)
  const currentRef = hasGitTag(currentTag) ? currentTag : 'HEAD'
  const items = collectNightlyItems(previousTag, currentRef)

  return {
    schemaVersion: 1,
    version,
    channel: 'nightly',
    publishedAt: new Date().toISOString(),
    provenance: 'generated',
    defaultLocale: 'en',
    compareUrl: previousTag ? buildCompareUrl(previousTag, currentTag) : buildReleaseUrl(version),
    locales: {
      en: {
        summary: buildNightlySummary(items.length),
        items,
      },
    },
  }
}

async function main() {
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'))
  const version = normalizeNullableText(packageJson.version)
  if (version === null) {
    throw new Error('package.json version is missing')
  }

  const manifest = isNightlyVersion(version)
    ? await buildNightlyManifest(version)
    : await loadStableManifest(version)

  await mkdir(outputDir, { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(ensureManifest(manifest), null, 2)}\n`)

  process.stdout.write(`Generated release manifest for ${version} at ${outputPath}\n`)
}

await main()
