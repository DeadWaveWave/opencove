// Per-file counts that may only go down. A count above the baseline fails; a count below it also
// fails until the baseline is regenerated, so every improvement is locked in by the same change.
// The totals functions at the end judge the baseline itself: a rule's total may not rise, or the
// rule disappear, from the merge base to the branch head without a line in the pull request.
import { hasRealReason } from './impact/partner-section.mjs'

export function compareRatchet({ counts, baseline, rules, describe }) {
  const issues = []
  for (const rule of rules) {
    const current = counts[rule] ?? {}
    const allowed = baseline?.[rule] ?? {}
    const files = [...new Set([...Object.keys(current), ...Object.keys(allowed)])].sort()
    for (const file of files) {
      const now = current[file] ?? 0
      const before = allowed[file] ?? 0
      if (now !== before) {
        issues.push({
          file,
          rule,
          baseline: before,
          current: now,
          message: describe(rule, now, before),
        })
      }
    }
  }
  return issues
}

export function formatRatchetIssues(issues, { title, footer, label = 'ui-style-check' }) {
  if (issues.length === 0) {
    return ''
  }
  const lines = [`[${label}] ${title} changed for ${issues.length} file(s):`]
  for (const issue of issues) {
    lines.push(`- ${issue.file} [${issue.rule}]`, `  ${issue.message}`)
  }
  lines.push('', footer)
  return `${lines.join('\n')}\n`
}

export function serializeRatchet(counts, rules) {
  const sorted = Object.fromEntries(
    [...rules].sort().map(rule => [
      rule,
      Object.fromEntries(
        Object.entries(counts[rule] ?? {})
          .filter(([, count]) => count > 0)
          .sort(([left], [right]) => left.localeCompare(right)),
      ),
    ]),
  )
  return `${JSON.stringify(sorted, null, 2)}\n`
}

export const RATCHET_RISES_HEADING = '## 📈 Ratchet rises'
export const RISE_CATEGORIES = ['merge-skew', 'detection', 'new-rule', 'rename', 'debt']
// Categories whose reason must name the pull request or issue that backs it.
const CATEGORIES_NEEDING_REFERENCE = new Set(['merge-skew', 'debt'])
const REASON_PLACEHOLDER = '<category>: <reason>'

/** Rule id -> sum of its per-file counts. `null` (no baseline) has no rules. */
export function ratchetTotals(baseline) {
  const totals = new Map()
  for (const [rule, byFile] of Object.entries(baseline ?? {})) {
    totals.set(
      rule,
      Object.values(byFile).reduce((sum, count) => sum + count, 0),
    )
  }
  return totals
}

function describeValue(value) {
  return JSON.stringify(value) ?? String(value)
}

/** Throws unless `json` is `{ rule: { file: positiveInteger } }`. `rev` only names the source. */
export function assertRatchetShape(path, rev, json) {
  const fail = detail => {
    throw new Error(
      `[ratchet] ${path} at ${rev}: ${detail}. A file whose name ends in ratchet.json is read as a ratchet baseline; rename it if it is not one.`,
    )
  }
  const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  if (!isObject(json)) {
    fail(`expected an object of rules, got ${describeValue(json)}`)
  }
  for (const [rule, byFile] of Object.entries(json)) {
    if (!isObject(byFile)) {
      fail(`rule "${rule}": expected an object of file counts, got ${describeValue(byFile)}`)
    }
    for (const [file, count] of Object.entries(byFile)) {
      if (!Number.isInteger(count) || count <= 0) {
        fail(
          `rule "${rule}", file "${file}": count must be a positive integer, got ${describeValue(count)}`,
        )
      }
    }
  }
}

/** Both arguments are `ratchetTotals` maps. A rule that is absent counts as total 0. */
export function compareRatchetTotals(before, after) {
  const rises = []
  const retired = []
  for (const [rule, to] of after) {
    const from = before.get(rule) ?? 0
    if (to > from) {
      rises.push({ rule, from, to })
    }
  }
  for (const [rule, from] of before) {
    if (from > 0 && !after.has(rule)) {
      retired.push({ rule, from })
    }
  }
  const byRule = (left, right) => (left.rule < right.rule ? -1 : left.rule > right.rule ? 1 : 0)
  return { rises: rises.sort(byRule), retired: retired.sort(byRule) }
}

// `entries` are `{ path, rule, from, to }`; `to` is `null` for a retired rule.
function formatRiseNumbers({ from, to }) {
  return `${from} -> ${to === null ? 'removed' : to}`
}

function formatRiseHead(entry) {
  return `- \`${entry.path}\` \`${entry.rule}\` ${formatRiseNumbers(entry)}`
}

export function formatRiseSection(entries) {
  const lines = entries.map(entry => `${formatRiseHead(entry)}: ${REASON_PLACEHOLDER}`)
  return `${RATCHET_RISES_HEADING}\n\n${lines.join('\n')}\n`
}

const RISE_LINE = /^\s*[-*]\s+`([^`]+)`\s+`([^`]+)`\s+(\d+)\s*->\s*(\d+|removed)\s*:\s*(.*?)\s*$/

function parseRiseLines(sectionBody) {
  const withoutComments = sectionBody.replace(/<!--[\s\S]*?-->/g, '')
  const parsed = []
  const malformed = []
  for (const line of withoutComments.split('\n')) {
    if (!/^\s*[-*]\s/.test(line)) {
      continue
    }
    const match = RISE_LINE.exec(line)
    if (!match) {
      malformed.push(line.trim())
      continue
    }
    const [, path, rule, from, to, rest] = match
    parsed.push({
      path,
      rule,
      numbers: `${from} -> ${to}`,
      rest,
      text: line.trim(),
    })
  }
  return { parsed, malformed }
}

function validateReason(entry, rest) {
  const label = `\`${entry.path}\` \`${entry.rule}\``
  const match = /^([a-z-]+):\s*(.*)$/.exec(rest)
  if (!match || !RISE_CATEGORIES.includes(match[1])) {
    return `${label}: the reason must start with one of ${RISE_CATEGORIES.map(name => `${name}:`).join(' ')}`
  }
  const [, category, reason] = match
  if (!hasRealReason(reason)) {
    return `${label}: ${category} needs a real reason after the category`
  }
  if (CATEGORIES_NEEDING_REFERENCE.has(category) && !/#\d+/.test(reason)) {
    return `${label}: ${category} must cite the pull request or issue as #N`
  }
  return null
}

/** Errors for the body of `RATCHET_RISES_HEADING` against the rises and retirements `entries`. */
export function validateRiseSection(sectionBody, entries) {
  const { parsed, malformed } = parseRiseLines(sectionBody)
  const errors = malformed.map(
    line =>
      `${RATCHET_RISES_HEADING}: "${line}" does not follow the line format (path, rule, N -> M, category, reason).`,
  )
  const keyOf = item => `${item.path}\0${item.rule}`
  const expected = new Map(entries.map(entry => [keyOf(entry), entry]))
  const seen = new Set()
  for (const line of parsed) {
    const entry = expected.get(keyOf(line))
    if (!entry) {
      errors.push(
        `${RATCHET_RISES_HEADING}: \`${line.path}\` \`${line.rule}\` has no rise or retirement in this change; remove the stale line.`,
      )
    } else if (seen.has(keyOf(line))) {
      errors.push(
        `${RATCHET_RISES_HEADING}: \`${line.path}\` \`${line.rule}\` is listed more than once.`,
      )
    } else if (line.numbers !== formatRiseNumbers(entry)) {
      errors.push(
        `${RATCHET_RISES_HEADING}: \`${line.path}\` \`${line.rule}\` is ${formatRiseNumbers(entry)} in this change, not ${line.numbers}.`,
      )
    } else {
      const problem = validateReason(entry, line.rest)
      if (problem) {
        errors.push(`${RATCHET_RISES_HEADING}: ${problem}.`)
      }
    }
    seen.add(keyOf(line))
  }
  for (const entry of entries) {
    if (!seen.has(keyOf(entry))) {
      errors.push(
        `${RATCHET_RISES_HEADING} is missing the line for \`${entry.path}\` \`${entry.rule}\` ${formatRiseNumbers(entry)}.`,
      )
    }
  }
  return errors
}
