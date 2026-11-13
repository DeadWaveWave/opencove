import { compareRatchet, formatRatchetIssues, serializeRatchet } from './ratchet.mjs'

// Classification of a `knip --production --reporter json` report. Pure functions only; the
// runner in scripts/check-dead-code.mjs owns process spawning and file IO.

export const DEAD_CODE_LABEL = 'dead-code-check'
export const RATCHET_RULES = ['exports', 'types']
export const RATCHET_FILE = 'scripts/dead-code-ratchet.json'

const FIX_HINTS = {
  files:
    'Unused file. Delete it. A file loaded by a path string (spawned process, worker) must be ' +
    'added to scripts/lib/build-entries.mjs with a comment naming where it is spawned. Test-only ' +
    'code belongs under tests/, not src/.',
  dependencies:
    'No production file imports this package. Remove it with `pnpm remove`, or move it to ' +
    'devDependencies if only tooling uses it.',
  unlisted: 'Imported by production code but missing from package.json. Add it with pnpm.',
  unresolved: 'Import that does not resolve. Fix the path or alias.',
  binaries: 'Binary run by name that no dependency provides. Add the package that ships it.',
  duplicates: 'The same symbol is exported under two names. Keep one.',
  enumMembers: 'Enum member no production code reads. Delete it.',
  namespaceMembers: 'Namespace member no production code reads. Delete it.',
  optionalPeerDependencies: 'Optional peer dependency used by production code. List it properly.',
}

const RATCHET_HINT = {
  exports:
    'No production file imports this export and its own file does not use it, so only tests ' +
    'keep it alive. Delete it. For a test seam, name it `...ForTests` and tag it `/** @internal */`.',
  types:
    'No production file imports this type and its own file does not use it. Delete it, or for a ' +
    'test seam name it `...ForTests` and tag it `/** @internal */`.',
}

function itemName(item) {
  return typeof item === 'string' ? item : (item?.name ?? item?.symbol ?? '(unknown)')
}

/** Split a knip report into zero-tolerance findings and per-file export/type counts. */
export function classifyKnipReport(report) {
  const findings = []
  const counts = Object.fromEntries(RATCHET_RULES.map(rule => [rule, {}]))
  for (const row of report?.issues ?? []) {
    for (const [category, value] of Object.entries(row)) {
      if (!Array.isArray(value) || value.length === 0) {
        continue
      }
      if (RATCHET_RULES.includes(category)) {
        counts[category][row.file] = value.length
        continue
      }
      for (const item of value) {
        findings.push({
          category,
          file: row.file,
          name: itemName(item),
          hint: FIX_HINTS[category] ?? 'Resolve the finding.',
        })
      }
    }
  }
  return { findings, counts }
}

export function describeRatchetChange(rule, now, before) {
  return now > before
    ? `${now} unused ${rule} (baseline ${before}). ${RATCHET_HINT[rule]}`
    : `${now} unused ${rule} (baseline ${before}); the count went down. Run \`pnpm deadcode:ratchet\` to lock it in.`
}

export function compareDeadCodeRatchet(counts, baseline) {
  return compareRatchet({
    counts,
    baseline,
    rules: RATCHET_RULES,
    describe: describeRatchetChange,
  })
}

const INTERNAL_EXPORT_PATTERN =
  /\/\*\*(?:(?!\*\/)[\s\S])*@internal(?:(?!\*\/)[\s\S])*\*\/\s*export\s+(?:declare\s+)?(?:default\s+)?(?:async\s+)?(?:abstract\s+)?(?:function\*?|const|let|var|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/g

/** `@internal` hides an export from knip, so only `...ForTests` seams may carry it. */
export function findInternalNamingViolations(sources) {
  const violations = []
  for (const { file, text } of sources) {
    for (const match of text.matchAll(INTERNAL_EXPORT_PATTERN)) {
      if (!match[1].endsWith('ForTests')) {
        violations.push({ file, name: match[1] })
      }
    }
  }
  return violations
}

export function formatDeadCodeReport({ findings, ratchetIssues, internalViolations }) {
  const lines = []
  for (const finding of findings) {
    const subject = finding.name === finding.file ? finding.file : `${finding.file} ${finding.name}`
    lines.push(`[${DEAD_CODE_LABEL}] ${finding.category}: ${subject}`)
    lines.push(`  ${finding.hint}`)
  }
  for (const violation of internalViolations) {
    lines.push(`[${DEAD_CODE_LABEL}] internal: ${violation.file} ${violation.name}`)
    lines.push(
      '  `@internal` hides an export from the dead-code check, so it is reserved for test seams. ' +
        'Rename it `...ForTests`, or remove the tag and delete the export if nothing ships it.',
    )
  }
  return (
    lines.map(line => `${line}\n`).join('') +
    formatRatchetIssues(ratchetIssues, {
      label: DEAD_CODE_LABEL,
      title: 'Unused export and type baseline',
      footer:
        'Counts may only go down. Renaming a baselined file moves its count to a new key, so ' +
        'resolve its findings instead of raising the baseline. After removing findings, run ' +
        '`pnpm deadcode:ratchet`.',
    })
  )
}

export function serializeDeadCodeRatchet(counts) {
  return serializeRatchet(counts, RATCHET_RULES)
}

/** Update is refused when any per-file count would rise above the committed baseline. */
export function raisedCounts(counts, baseline) {
  return compareDeadCodeRatchet(counts, baseline).filter(issue => issue.current > issue.baseline)
}

export function formatRaisedCounts(raised) {
  return formatRatchetIssues(raised, {
    label: DEAD_CODE_LABEL,
    title: 'Unused export and type counts (baseline update refused)',
    footer: 'The baseline can only shrink. Delete the new unused code instead of recording it.',
  })
}
