// Per-file counts that may only go down. A count above the baseline fails; a count below it also
// fails until the baseline is regenerated, so every improvement is locked in by the same change.

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

export function formatRatchetIssues(issues, { title, footer }) {
  if (issues.length === 0) {
    return ''
  }
  const lines = [`[ui-style-check] ${title} changed for ${issues.length} file(s):`]
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
