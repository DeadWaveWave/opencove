#!/usr/bin/env node

// Compatibility expiry gate. Every compatibility path has one entry in
// `src/shared/compat/compatRegistry.json`; the check fails when an entry has expired, when an id
// is unknown or unused, and when unmarked compatibility signals grow past the baseline.
// See docs/development/COMPATIBILITY_EXPIRY.md.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { hasFileMarker, scanCompatSource, SIGNAL_RULES } from './lib/compatMarkers.mjs'
import {
  compareVersions,
  findExpired,
  nextMinorVersion,
  parseVersion,
  validateRegistry,
} from './lib/compatRegistry.mjs'
import { compareRatchet, formatRatchetIssues, serializeRatchet } from './lib/ratchet.mjs'
import { guardRatchetUpdate, parseAcceptRises } from './lib/ratchet-git.mjs'
import { isCompatScannedFile, isOracleFile, isParitySpecFile } from './lib/compatScope.mjs'
import { listRepositoryFiles, resolveRepositoryRoot } from './lib/repo-files.mjs'

const REGISTRY_FILE = 'src/shared/compat/compatRegistry.json'
const RATCHET_FILE = 'scripts/compat-ratchet.json'
const FEATURE_FLAG_DIRECTORY = 'src/shared/featureFlags/'
const REGISTRY_INFRASTRUCTURE_DIRECTORY = 'src/shared/compat/'
const LABEL = 'compat-check'

function readJson(root, path, fallback) {
  try {
    return JSON.parse(readFileSync(resolve(root, path), 'utf8'))
  } catch (error) {
    if (fallback !== undefined && error?.code === 'ENOENT') {
      return fallback
    }
    throw new Error(`Cannot read ${path}: ${error.message}`, { cause: error })
  }
}

function parseArguments(argv) {
  const { rules: acceptRises, rest } = parseAcceptRises(argv)
  const options = { at: null, report: false, updateRatchet: false, acceptRises }
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index]
    if (argument === '--at') {
      options.at = rest[(index += 1)] ?? ''
    } else if (argument === '--report') {
      options.report = true
    } else if (argument === '--update-ratchet') {
      options.updateRatchet = true
    } else {
      throw new Error(
        `Unknown argument ${argument}. Use --at <version>, --report, --update-ratchet [--accept-rise <rule>].`,
      )
    }
  }
  if (acceptRises.length > 0 && !options.updateRatchet) {
    throw new Error('--accept-rise only applies together with --update-ratchet.')
  }
  if (options.at !== null && parseVersion(options.at) === null) {
    throw new Error(`--at needs a version like 0.7.0 (got ${JSON.stringify(options.at)}).`)
  }
  return options
}

function describeIssue(issue) {
  const location = issue.file ? `${issue.file}${issue.line ? `:${issue.line}` : ''}` : REGISTRY_FILE
  return `- ${location} [${issue.rule}]${issue.id ? ` (${issue.id})` : ''}\n  ${issue.message}\n`
}

function printReport({ current, support, entries, fileMarkers }) {
  const next = nextMinorVersion(current)
  const lines = [`[${LABEL}] report at ${current}; next minor release is ${next}`]
  const expiring = Object.entries(entries).filter(
    ([, entry]) =>
      entry.expires.until !== undefined &&
      compareVersions(current, entry.expires.until) < 0 &&
      compareVersions(next, entry.expires.until) >= 0,
  )
  lines.push(`Entries that expire at ${next}:${expiring.length === 0 ? ' none' : ''}`)
  for (const [id, entry] of expiring) {
    lines.push(`- ${id} (until ${entry.expires.until}): ${entry.reason}`)
  }
  if (support) {
    lines.push(`Upgrade floor ${support.floor}, reviewed by ${support.reviewBy}`)
  }
  lines.push(`File-level markers (${fileMarkers.length}):`)
  for (const marker of fileMarkers) {
    lines.push(`- ${marker.file} (${marker.id})`)
  }
  process.stdout.write(`${lines.join('\n')}\n`)
}

function run() {
  const options = parseArguments(process.argv.slice(2))
  const root = resolveRepositoryRoot()
  const packageVersion = readJson(root, 'package.json').version
  const current = options.at ?? packageVersion
  if (parseVersion(packageVersion) === null) {
    throw new Error(`package.json version ${JSON.stringify(packageVersion)} is not x.y.z.`)
  }
  const registry = readJson(root, REGISTRY_FILE)
  const files = listRepositoryFiles(root).filter(isCompatScannedFile)

  const issues = []
  const { support, entries } = validateRegistry(registry, issues, packageVersion)
  issues.push(...findExpired({ support, entries, current }))

  const knownIds = new Set(Object.keys(registry.entries ?? {}))
  const usedIds = new Set()
  const fileMarkers = []
  const counts = Object.fromEntries(SIGNAL_RULES.map(rule => [rule, {}]))
  let scannedFiles = 0

  for (const file of files) {
    let source
    try {
      source = readFileSync(resolve(root, file), 'utf8')
    } catch (error) {
      // git ls-files retains unstaged deletions; inspect the current worktree without staging it.
      if (error?.code === 'ENOENT') {
        continue
      }
      throw error
    }
    scannedFiles += 1
    const scan = scanCompatSource(file, source)
    for (const problem of scan.problems) {
      issues.push({
        file,
        line: problem.line,
        id: problem.id,
        rule: 'marker',
        message: problem.message,
      })
    }
    for (const usage of [...scan.markers, ...scan.anchors]) {
      usedIds.add(usage.id)
      if (!knownIds.has(usage.id)) {
        issues.push({
          file,
          line: usage.line,
          id: usage.id,
          rule: 'unknown-id',
          message: `\`${usage.id}\` is not in ${REGISTRY_FILE}: add an entry or fix the id.`,
        })
      }
    }
    for (const marker of scan.markers.filter(entry => entry.file)) {
      fileMarkers.push({ file, id: marker.id })
    }
    if (file.startsWith(FEATURE_FLAG_DIRECTORY) && !hasFileMarker(scan)) {
      issues.push({
        file,
        line: 1,
        rule: 'feature-flag-unmarked',
        message:
          'Feature flags are compatibility code: add `// @compat-file <id>` in the first lines.',
      })
    }
    if (isOracleFile(file) && scan.markers.length + scan.anchors.length === 0) {
      issues.push({
        file,
        line: 1,
        rule: 'oracle-unmarked',
        message: 'Legacy oracle files need `// @compat-file <id>` in the first lines.',
      })
    }
    if (isParitySpecFile(file) && !hasFileMarker(scan)) {
      issues.push({
        file,
        line: 1,
        rule: 'parity-spec-unmarked',
        message:
          'Parity specs compare the legacy oracles with the schemas: add `// @compat-file <id>` in the first lines.',
      })
    }
    if (!file.startsWith(REGISTRY_INFRASTRUCTURE_DIRECTORY)) {
      for (const signal of scan.signals) {
        counts[signal.rule][file] = (counts[signal.rule][file] ?? 0) + 1
      }
    }
  }

  for (const id of [...knownIds].sort()) {
    if (!usedIds.has(id)) {
      issues.push({
        rule: 'stale-entry',
        id,
        message: `entry \`${id}\` is used by no marker or typed anchor: delete the entry, or mark the code it covers.`,
      })
    }
  }

  if (options.report) {
    printReport({ current, support, entries, fileMarkers })
    return 0
  }
  if (scannedFiles === 0) {
    process.stderr.write(`[${LABEL}] scanned 0 files: this is not a pass.\n`)
    return 1
  }
  if (options.updateRatchet) {
    const serialized = serializeRatchet(counts, SIGNAL_RULES)
    const guard = guardRatchetUpdate({
      root,
      path: RATCHET_FILE,
      next: serialized,
      acceptRises: options.acceptRises,
      hint: 'Mark the new code with `// @compat <id>` instead.',
      label: LABEL,
    })
    if (!guard.ok) {
      process.stderr.write(guard.text)
      return 1
    }
    mkdirSync(dirname(resolve(root, RATCHET_FILE)), { recursive: true })
    writeFileSync(resolve(root, RATCHET_FILE), serialized)
    process.stdout.write(guard.text)
  }

  const ratchetIssues = options.updateRatchet
    ? []
    : compareRatchet({
        counts,
        baseline: readJson(root, RATCHET_FILE, {}),
        rules: SIGNAL_RULES,
        describe: (rule, now, before) =>
          now > before
            ? `${now} unmarked ${rule} signal(s), baseline ${before}: add \`// @compat <id>\` above the code, or remove the signal.`
            : `${now} unmarked ${rule} signal(s), baseline ${before}: lock the improvement with \`node scripts/check-compat-expiry.mjs --update-ratchet\`.`,
      })
  if (issues.length === 0 && ratchetIssues.length === 0) {
    process.stdout.write(
      `[${LABEL}] scanned ${scannedFiles} files at version ${current}, ${Object.keys(entries).length} entries, no violations\n`,
    )
    return 0
  }
  if (issues.length > 0) {
    process.stderr.write(`[${LABEL}] ${issues.length} violation(s) at version ${current}:\n`)
    process.stderr.write(issues.map(describeIssue).join(''))
  }
  process.stderr.write(
    formatRatchetIssues(ratchetIssues, {
      title: 'Unmarked compatibility signals',
      label: LABEL,
      footer:
        'Mark compatibility code with `// @compat <id>` (see docs/development/COMPATIBILITY_EXPIRY.md); the baseline only goes down.',
    }),
  )
  return 1
}

try {
  process.exitCode = run()
} catch (error) {
  process.stderr.write(`[${LABEL}] ${error.message}\n`)
  process.exitCode = 1
}
