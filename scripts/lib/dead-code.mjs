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

// The one accepted form: a JSDoc block directly above an `export <declaration>`.
const TAGGED_EXPORT_PATTERN =
  /\/\*\*((?:(?!\*\/)[\s\S])*?)\*\/\s*export\s+(?:declare\s+)?(?:default\s+)?(?:async\s+)?(?:abstract\s+)?(?:function\*?|const|let|var|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/g
const FORBIDDEN_TAG_PATTERN = /@(public|beta|alias)\b/g
const INTERNAL_TAG_PATTERN = /@internal\b/g

const lineOf = (text, index) => text.slice(0, index).split('\n').length

/**
 * knip never reports an export carrying `@internal`, `@public`, `@beta` or `@alias` (the last hides
 * `duplicates`), wherever the tag is written: JSDoc, line or block comment, on a declaration or an
 * export list. So `@public`, `@beta` and `@alias` are forbidden anywhere in the files read, and
 * every `@internal` must sit in the accepted form on a `...ForTests` declaration.
 */
export function findInternalNamingViolations(sources) {
  const violations = []
  for (const { file, text } of sources) {
    for (const match of text.matchAll(FORBIDDEN_TAG_PATTERN)) {
      violations.push({ file, line: lineOf(text, match.index), tag: match[1] })
    }
    const accepted = new Set()
    for (const match of text.matchAll(TAGGED_EXPORT_PATTERN)) {
      if (!match[2].endsWith('ForTests')) {
        continue
      }
      for (const tag of match[1].matchAll(INTERNAL_TAG_PATTERN)) {
        accepted.add(match.index + 3 + tag.index)
      }
    }
    for (const match of text.matchAll(INTERNAL_TAG_PATTERN)) {
      if (!accepted.has(match.index)) {
        violations.push({ file, line: lineOf(text, match.index), tag: 'internal' })
      }
    }
  }
  return violations.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
}

export function formatDeadCodeReport({ findings, ratchetIssues, internalViolations }) {
  const lines = []
  for (const finding of findings) {
    const subject = finding.name === finding.file ? finding.file : `${finding.file} ${finding.name}`
    lines.push(`[${DEAD_CODE_LABEL}] ${finding.category}: ${subject}`)
    lines.push(`  ${finding.hint}`)
  }
  for (const violation of internalViolations) {
    lines.push(`[${DEAD_CODE_LABEL}] ${violation.tag}: ${violation.file}:${violation.line}`)
    lines.push(
      `  \`@${violation.tag}\` hides an export from the dead-code check. Remove the tag; delete the ` +
        'export if nothing imports it. A test seam is named `...ForTests` and tagged `@internal` ' +
        'in a JSDoc block directly above its declaration.',
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
