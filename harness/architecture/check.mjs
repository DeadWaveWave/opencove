#!/usr/bin/env node
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { formatArchitectureReport, runArchitectureAudit } from './lib/architecture-rules.mjs'

function readOption(name, fallback = null) {
  const index = process.argv.indexOf(name)
  if (index === -1) {
    return fallback
  }
  return process.argv[index + 1] ?? fallback
}

const mode = readOption('--mode', 'audit')
const format = readOption('--format', 'text')
const configPath = readOption('--config')
const severity = readOption('--severity', 'all')
const writeResultsDir = readOption('--write-results')
const hasFormatOption = process.argv.includes('--format')

const report = await runArchitectureAudit({ configPath: configPath ?? undefined })
const outputReport =
  severity === 'error'
    ? {
        ...report,
        summary: {
          errors: report.summary.errors,
          warnings: 0,
          violations: report.summary.errors,
        },
        violations: report.violations.filter(violation => violation.severity === 'error'),
      }
    : report

function summarizeReport(reportToSummarize) {
  const byRule = reportToSummarize.violations.reduce((counts, violation) => {
    counts[violation.ruleId] = (counts[violation.ruleId] ?? 0) + 1
    return counts
  }, {})
  const byTopArea = reportToSummarize.violations.reduce((counts, violation) => {
    const parts = violation.file.split('/')
    const area = parts.slice(0, Math.min(4, parts.length - 1)).join('/')
    counts[area] = (counts[area] ?? 0) + 1
    return counts
  }, {})

  return {
    filesAnalyzed: reportToSummarize.filesAnalyzed,
    summary: reportToSummarize.summary,
    byRule,
    topAreas: Object.entries(byTopArea)
      .sort((left, right) => right[1] - left[1])
      .slice(0, 10)
      .map(([area, count]) => ({ area, count })),
  }
}

const resultFilenamesByRule = new Map([
  ['architecture.windowOpenCoveApiBoundary', 'window-opencove-api.jsonl'],
  ['architecture.layerDependency', 'layer-dependency.jsonl'],
])

function toKebabCase(value) {
  return value
    .replace(/^architecture\./, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
}

function getResultFilename(ruleId) {
  return resultFilenamesByRule.get(ruleId) ?? `${toKebabCase(ruleId)}.jsonl`
}

async function writeResultFiles(reportToWrite, outputDir) {
  await mkdir(outputDir, { recursive: true })
  const existingEntries = await readdir(outputDir).catch(() => [])
  await Promise.all(
    existingEntries
      .filter(entry => entry.endsWith('.jsonl'))
      .map(async entry => await rm(join(outputDir, entry), { force: true })),
  )

  const violationsByRule = new Map()
  for (const violation of reportToWrite.violations) {
    const violations = violationsByRule.get(violation.ruleId) ?? []
    violations.push(violation)
    violationsByRule.set(violation.ruleId, violations)
  }

  await writeFile(
    join(outputDir, 'summary.json'),
    `${JSON.stringify(summarizeReport(reportToWrite), null, 2)}\n`,
    'utf8',
  )

  await Promise.all(
    [...violationsByRule.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(async ([ruleId, violations]) => {
        const lines = violations.map(violation => JSON.stringify(violation))
        await writeFile(join(outputDir, getResultFilename(ruleId)), `${lines.join('\n')}\n`, 'utf8')
      }),
  )
}

if (writeResultsDir) {
  await writeResultFiles(outputReport, writeResultsDir)
}

if (format === 'json') {
  process.stdout.write(`${JSON.stringify(outputReport, null, 2)}\n`)
} else if (format === 'jsonl') {
  const lines = outputReport.violations.map(violation => JSON.stringify(violation))
  process.stdout.write(`${lines.join('\n')}\n`)
} else if (format === 'summary-json') {
  process.stdout.write(`${JSON.stringify(summarizeReport(outputReport), null, 2)}\n`)
} else if (!writeResultsDir || hasFormatOption) {
  process.stdout.write(formatArchitectureReport(outputReport))
}

if (mode === 'check' && report.summary.errors > 0) {
  process.exitCode = 1
}
