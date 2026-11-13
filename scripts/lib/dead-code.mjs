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
    'No production file imports it and its own file does not use it. Delete it. For a test ' +
    'seam, name it `...ForTests` and tag it `/** @internal */`.',
  types:
    'No production file imports it and its own file does not use it. Delete it, or for a test ' +
    'seam name it `...ForTests` and tag it `/** @internal */`.',
}

function itemName(item) {
  return typeof item === 'string' ? item : (item?.name ?? item?.symbol ?? '(unknown)')
}

/** Split a knip report into zero-tolerance findings and per-file export/type counts. */
export function classifyKnipReport(report) {
  const findings = []
  const counts = Object.fromEntries(RATCHET_RULES.map(rule => [rule, {}]))
  const names = Object.fromEntries(RATCHET_RULES.map(rule => [rule, {}]))
  for (const row of report?.issues ?? []) {
    for (const [category, value] of Object.entries(row)) {
      if (!Array.isArray(value) || value.length === 0) {
        continue
      }
      if (RATCHET_RULES.includes(category)) {
        counts[category][row.file] = value.length
        names[category][row.file] = value.map(itemName)
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
  return { findings, counts, names }
}

export function describeRatchetChange(rule, now, before) {
  return now > before
    ? `${now} unused ${rule} (baseline ${before}). ${RATCHET_HINT[rule]}`
    : `${now} unused ${rule} (baseline ${before}); the count went down. Run \`pnpm deadcode:ratchet\` to lock it in.`
}

/** `names` (per rule and file, from classifyKnipReport) lists the current unused symbols. */
export function compareDeadCodeRatchet(counts, baseline, names = {}) {
  return compareRatchet({
    counts,
    baseline,
    rules: RATCHET_RULES,
    describe: describeRatchetChange,
  }).map(issue => {
    const current = names[issue.rule]?.[issue.file]
    return current?.length
      ? { ...issue, message: `${issue.message} Currently unused: ${current.join(', ')}.` }
      : issue
  })
}

const TAGGED_EXPORT_PATTERN =
  /\/\*\*(?:(?!\*\/)[\s\S])*?@(internal|public|beta)\b(?:(?!\*\/)[\s\S])*\*\/\s*export\s+(?:declare\s+)?(?:default\s+)?(?:async\s+)?(?:abstract\s+)?(?:function\*?|const|let|var|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/g

/**
 * knip never reports an export tagged `@internal`, `@public` or `@beta`, so each tag would hide a
 * dead export. `@internal` is reserved for `...ForTests` seams; `@public` and `@beta` are never
 * allowed under src/.
 */
export function findInternalNamingViolations(sources) {
  const violations = []
  for (const { file, text } of sources) {
    for (const match of text.matchAll(TAGGED_EXPORT_PATTERN)) {
      const [, tag, name] = match
      if (tag !== 'internal' || !name.endsWith('ForTests')) {
        violations.push({ file, name, tag })
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
    const tag = violation.tag ?? 'internal'
    lines.push(`[${DEAD_CODE_LABEL}] ${tag}: ${violation.file} ${violation.name}`)
    lines.push(
      tag === 'internal'
        ? '  `@internal` hides an export from the dead-code check, so it is reserved for test seams. ' +
            'Rename it `...ForTests`, or remove the tag and delete the export if nothing ships it.'
        : `  \`@${tag}\` hides an export from the dead-code check and is not allowed under src/. ` +
            'Remove the tag; if nothing imports the export, delete it.',
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
export function raisedCounts(counts, baseline, names = {}) {
  return compareDeadCodeRatchet(counts, baseline, names).filter(
    issue => issue.current > issue.baseline,
  )
}

export function formatRaisedCounts(raised) {
  return formatRatchetIssues(raised, {
    label: DEAD_CODE_LABEL,
    title: 'Unused export and type counts (baseline update refused)',
    footer: 'The baseline can only shrink. Delete the new unused code instead of recording it.',
  })
}

export function formatMissingBaseline() {
  return (
    `[${DEAD_CODE_LABEL}] ${RATCHET_FILE} is missing but exists in git HEAD. Refusing to recreate ` +
    'it, because that would record every current unused export as the new baseline. Restore it ' +
    `with \`git checkout -- ${RATCHET_FILE}\`. Only an intentional first run may pass --bootstrap.\n`
  )
}
