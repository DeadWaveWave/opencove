import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { collectContextRuleSeverities } from './context-rules.mjs'
import { collectVariantRuleSeverities } from './variant-rules.mjs'
import {
  compareRatchet,
  formatRatchetIssues,
  serializeRatchet,
} from '../../../scripts/lib/ratchet.mjs'
import { guardRatchetUpdate } from '../../../scripts/lib/ratchet-git.mjs'

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

export const defaultRatchetBaselinePath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'ratchet.json',
)

const RATCHET_COMMAND = 'pnpm arch:ratchet'
const BASELINE_FILE = 'harness/architecture/ratchet.json'

// Every rule id the audit can emit, with its configured severity.
export function collectRuleSeverities(config) {
  const severities = new Map()
  const checks = config.checks ?? {}
  if (checks.layerDependencies) {
    severities.set('architecture.layerDependency', checks.layerDependencies.severity)
  }
  if (checks.fileRuntimeCycles) {
    severities.set('architecture.fileRuntimeCycle', checks.fileRuntimeCycles.severity ?? 'error')
  }
  for (const rule of [
    ...(checks.forbiddenImportSpecifiers ?? []),
    ...(checks.forbiddenText ?? []),
  ]) {
    severities.set(rule.id, rule.severity)
  }
  if (checks.rendererBridge) {
    severities.set(checks.rendererBridge.id, checks.rendererBridge.severity)
  }
  for (const [rule, severity] of collectContextRuleSeverities(config)) {
    severities.set(rule, severity)
  }
  for (const [rule, severity] of collectVariantRuleSeverities(config)) {
    severities.set(rule, severity)
  }
  return severities
}

function ratchetedRules(config) {
  return [...collectRuleSeverities(config)]
    .filter(([, severity]) => severity === 'warn')
    .map(([rule]) => rule)
    .sort()
}

export function countRatchetedFindings({ report, config }) {
  const rules = new Set(ratchetedRules(config))
  const counts = {}
  for (const violation of report.violations) {
    if (!rules.has(violation.ruleId)) {
      continue
    }
    const byFile = (counts[violation.ruleId] ??= {})
    byFile[violation.file] = (byFile[violation.file] ?? 0) + 1
  }
  return counts
}

function describeCount(rule, now, before) {
  if (now > before) {
    return before === 0
      ? `${now} finding(s), none allowed by the baseline. Fix the code or add a reasoned exception to harness/architecture/rules.json.`
      : `${now} finding(s), ${now - before} more than the baseline of ${before}. Fix the code or add a reasoned exception to harness/architecture/rules.json.`
  }
  return `count dropped from ${before} to ${now}; run \`${RATCHET_COMMAND}\` and commit \`${BASELINE_FILE}\``
}

function findBaselineEntryIssues({ baseline, severities }) {
  const issues = []
  for (const rule of Object.keys(baseline ?? {}).sort()) {
    const severity = severities.get(rule)
    if (severity === 'warn') {
      continue
    }
    issues.push({
      file: BASELINE_FILE,
      rule,
      message: severity
        ? 'error-level rules must have 0 findings and cannot appear in the baseline.'
        : 'unknown rule; remove it from the baseline.',
    })
  }
  return issues
}

export function evaluateRatchet({ report, config, baseline }) {
  const severities = collectRuleSeverities(config)
  const rules = ratchetedRules(config)
  const errors = report.violations.filter(violation => violation.severity === 'error')
  const issues = [
    ...findBaselineEntryIssues({ baseline, severities }),
    ...compareRatchet({
      counts: countRatchetedFindings({ report, config }),
      baseline,
      rules,
      describe: describeCount,
    }),
  ]

  const sections = []
  if (errors.length > 0) {
    const lines = [`[architecture-check] ${errors.length} error-level finding(s):`]
    for (const error of errors) {
      lines.push(`- ${error.file}:${error.line} [${error.ruleId}]`, `  ${error.message}`)
      if (error.found) {
        lines.push(`  found: ${error.found}`)
      }
    }
    sections.push(`${lines.join('\n')}\n`)
  }
  sections.push(
    formatRatchetIssues(issues, {
      label: 'architecture-check',
      title: 'Architecture ratchet',
      footer: `See harness/architecture/README.md for the ratchet and how to add a reasoned exception.`,
    }),
  )

  return {
    ok: errors.length === 0 && issues.length === 0,
    errors,
    issues,
    output: sections.filter(Boolean).join('\n'),
  }
}

// The counts to record. Whether they may be recorded is `updateRatchetBaseline`'s decision.
export function planRatchetUpdate({ report, config }) {
  const counts = countRatchetedFindings({ report, config })
  return { counts, serialized: serializeRatchet(counts, ratchetedRules(config)) }
}

// Writes the baseline unless a rule total rises or a rule disappears against the merge base with
// origin/main, which only `--accept-rise <rule>` allows. Returns the exit code.
export async function updateRatchetBaseline({
  report,
  config,
  root = REPOSITORY_ROOT,
  acceptRises = [],
  stdout = process.stdout,
  stderr = process.stderr,
}) {
  const { serialized } = planRatchetUpdate({ report, config })
  const guard = guardRatchetUpdate({
    root,
    path: BASELINE_FILE,
    next: serialized,
    acceptRises,
    hint: 'Fix the new violations, or add a reasoned exception to harness/architecture/rules.json.',
    label: 'architecture-ratchet',
  })
  if (!guard.ok) {
    stderr.write(guard.text)
    return 1
  }
  await writeFile(resolve(root, BASELINE_FILE), serialized, 'utf8')
  stdout.write(guard.text)
  stdout.write(`Architecture ratchet written to ${BASELINE_FILE}.\n`)
  return 0
}

export async function loadRatchetBaseline(path = defaultRatchetBaselinePath) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return null
    }
    throw error
  }
}
