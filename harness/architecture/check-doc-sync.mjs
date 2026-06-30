#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const contractDocs = new Set([
  'docs/architecture/ARCHITECTURE.md',
  'docs/architecture/CONTROL_SURFACE.md',
  'docs/architecture/RECOVERY_MODEL.md',
])

const resultsDir = 'harness/architecture/results'

function runGit(args) {
  return execFileSync('git', args, { encoding: 'utf8' })
}

function getStagedFiles() {
  return runGit(['diff', '--cached', '--name-only'])
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
}

function getUnstagedFiles() {
  return runGit(['diff', '--name-only'])
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
}

function isContractSyncEvidence(pathname) {
  return (
    pathname === 'docs/architecture/ARCHITECTURE_HARNESS.md' ||
    pathname === 'harness/architecture/check.mjs' ||
    pathname === 'harness/architecture/rules.json' ||
    pathname.startsWith('harness/architecture/lib/')
  )
}

function isAuditRelevant(pathname) {
  return (
    pathname === 'harness/architecture/check.mjs' ||
    pathname === 'harness/architecture/rules.json' ||
    pathname.startsWith('harness/architecture/lib/') ||
    pathname.startsWith('src/')
  )
}

function isResultFile(pathname) {
  return pathname.startsWith('harness/architecture/results/')
}

function readRequiredFile(pathname) {
  if (!existsSync(pathname)) {
    throw new Error(`Required architecture harness result is missing: ${pathname}`)
  }
  return readFileSync(pathname, 'utf8')
}

function listResultFiles(directory) {
  if (!existsSync(directory)) {
    return []
  }
  return readdirSync(directory)
    .filter(entry => entry === 'summary.json' || entry.endsWith('.jsonl'))
    .sort()
}

function runAuditResults(outputDir) {
  execFileSync(
    process.execPath,
    ['harness/architecture/check.mjs', '--mode', 'audit', '--write-results', outputDir],
    { encoding: 'utf8' },
  )
}

function compareResultDirectories(actualDir, expectedDir) {
  const actualFiles = listResultFiles(actualDir)
  const expectedFiles = listResultFiles(expectedDir)
  const actualSet = new Set(actualFiles)
  const expectedSet = new Set(expectedFiles)
  const missingFiles = expectedFiles.filter(file => !actualSet.has(file))
  const unexpectedFiles = actualFiles.filter(file => !expectedSet.has(file))
  const changedFiles = expectedFiles.filter(file => {
    if (!actualSet.has(file)) {
      return false
    }
    return readRequiredFile(join(actualDir, file)) !== readRequiredFile(join(expectedDir, file))
  })

  return { missingFiles, unexpectedFiles, changedFiles }
}

function fail(title, messages) {
  process.stderr.write(`${title} failed:\n\n${messages.join('\n\n')}\n`)
  process.exitCode = 1
}

function verifyResultFiles(failures) {
  const expectedDir = mkdtempSync(join(tmpdir(), 'opencove-architecture-results-'))
  try {
    runAuditResults(expectedDir)
    const { missingFiles, unexpectedFiles, changedFiles } = compareResultDirectories(
      resultsDir,
      expectedDir,
    )

    if (missingFiles.length > 0 || unexpectedFiles.length > 0 || changedFiles.length > 0) {
      failures.push(
        [
          'Architecture audit results are stale.',
          '',
          missingFiles.length > 0 ? `Missing result files: ${missingFiles.join(', ')}` : null,
          unexpectedFiles.length > 0
            ? `Unexpected result files: ${unexpectedFiles.join(', ')}`
            : null,
          changedFiles.length > 0 ? `Changed result files: ${changedFiles.join(', ')}` : null,
          '',
          'Regenerate with:',
          `node harness/architecture/check.mjs --mode audit --write-results ${resultsDir}`,
        ]
          .filter(Boolean)
          .join('\n'),
      )
    }
  } finally {
    rmSync(expectedDir, { recursive: true, force: true })
  }
}

const verifyResults = process.argv.includes('--verify-results')
const stagedFiles = getStagedFiles()
const changedContractDocs = stagedFiles.filter(pathname => contractDocs.has(pathname))
const hasContractSyncEvidence = stagedFiles.some(isContractSyncEvidence)
const allowDocOnly =
  process.argv.includes('--allow-doc-only') || process.env.OPENCOVE_ARCH_DOC_NO_RULE_IMPACT === '1'

const failures = []

if (!verifyResults && changedContractDocs.length > 0 && !hasContractSyncEvidence && !allowDocOnly) {
  failures.push(
    [
      'Architecture contract docs changed without architecture harness sync evidence:',
      ...changedContractDocs.map(pathname => `- ${pathname}`),
      '',
      'Update harness/architecture rules, analyzer code, or ARCHITECTURE_HARNESS.md.',
      'For wording-only changes, set OPENCOVE_ARCH_DOC_NO_RULE_IMPACT=1 or rerun with --allow-doc-only, then document the no-rule-impact decision in review.',
    ].join('\n'),
  )
}

const shouldVerifyResults =
  verifyResults || stagedFiles.some(isAuditRelevant) || stagedFiles.some(isResultFile)

if (shouldVerifyResults) {
  const unstagedAuditFiles = verifyResults
    ? []
    : getUnstagedFiles().filter(pathname => isAuditRelevant(pathname) || isResultFile(pathname))
  if (!verifyResults && unstagedAuditFiles.length > 0) {
    failures.push(
      [
        'Audit-relevant files have unstaged changes, so staged result verification would be ambiguous:',
        ...unstagedAuditFiles.map(pathname => `- ${pathname}`),
        '',
        'Stage or discard these changes before running arch:doc-sync.',
      ].join('\n'),
    )
  } else {
    verifyResultFiles(failures)
  }
}

if (failures.length > 0) {
  fail(verifyResults ? 'Architecture result verification' : 'Architecture doc sync check', failures)
} else {
  process.stdout.write(
    verifyResults
      ? 'Architecture result verification passed.\n'
      : 'Architecture doc sync check passed.\n',
  )
}
