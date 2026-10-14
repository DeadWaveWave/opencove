// Ratchet for hard-coded scale values in renderer CSS. New code uses the --cove-* scale tokens;
// existing values are counted per file and the counts may only go down.

export const SCALE_RULES = ['font-size', 'radius', 'spacing', 'z-index']

const TOKEN_HINTS = {
  'font-size': '--cove-font-size-*',
  radius: '--cove-radius-*',
  spacing: '--cove-spacing-*',
  'z-index': '--cove-z-*',
}

const DECLARATION_PATTERN = /(?<![\w-])([a-z][a-z-]*)\s*:\s*([^;{}]*)/g
const LENGTH_PATTERN = /(-?\d*\.?\d+)(px|rem|em)\b/g

function stripComments(content) {
  return content.replace(/\/\*[\s\S]*?\*\//g, '')
}

function scaleRuleFor(property) {
  if (property === 'font-size') {
    return 'font-size'
  }
  if (property === 'z-index') {
    return 'z-index'
  }
  if (/^border(?:-[a-z]+)*-radius$/.test(property)) {
    return 'radius'
  }
  if (
    /^(?:row-|column-)?gap$/.test(property) ||
    /^(?:padding|margin)(?:-[a-z]+)*$/.test(property)
  ) {
    return 'spacing'
  }
  return null
}

function isHardCoded(rule, value) {
  if (rule === 'z-index') {
    // Page-level layers come from tokens; small integers stack inside one component.
    const trimmed = value.trim()
    return /^-?\d+$/.test(trimmed) && Math.abs(Number(trimmed)) >= 10
  }
  for (const [, number, unit] of value.matchAll(LENGTH_PATTERN)) {
    const magnitude = Math.abs(Number(number))
    if (magnitude === 0) {
      continue
    }
    // One to three pixels of spacing are optical nudges, below the 4px grid.
    if (rule === 'spacing' && unit === 'px' && magnitude < 4) {
      continue
    }
    return true
  }
  return false
}

export function countScaleLiterals(files) {
  const counts = Object.fromEntries(SCALE_RULES.map(rule => [rule, {}]))
  for (const file of files) {
    for (const [, property, value] of stripComments(file.content).matchAll(DECLARATION_PATTERN)) {
      const rule = scaleRuleFor(property)
      if (rule && isHardCoded(rule, value)) {
        counts[rule][file.path] = (counts[rule][file.path] ?? 0) + 1
      }
    }
  }
  return counts
}

export function compareScaleRatchet(counts, baseline) {
  const issues = []
  for (const rule of SCALE_RULES) {
    const current = counts[rule] ?? {}
    const allowed = baseline?.[rule] ?? {}
    const files = [...new Set([...Object.keys(current), ...Object.keys(allowed)])].sort()
    for (const file of files) {
      const now = current[file] ?? 0
      const before = allowed[file] ?? 0
      if (now === before) {
        continue
      }
      const message =
        now > before
          ? `${now} hard-coded ${rule} values, ${now - before} more than the baseline. Use \`${TOKEN_HINTS[rule]}\` tokens.`
          : `${now} hard-coded ${rule} values, below the baseline of ${before}. Run \`pnpm ui:style-ratchet\` to lock in the improvement.`
      issues.push({ file, rule, baseline: before, current: now, message })
    }
  }
  return issues
}

export function formatScaleRatchetIssues(issues) {
  if (issues.length === 0) {
    return ''
  }
  const lines = [`[ui-style-check] Scale ratchet changed for ${issues.length} file(s):`]
  for (const issue of issues) {
    lines.push(`- ${issue.file} [${issue.rule}]`, `  ${issue.message}`)
  }
  lines.push('', 'See docs/ui/README.md for the scale tokens and the ratchet.')
  return `${lines.join('\n')}\n`
}

export function serializeScaleRatchet(counts) {
  const sorted = Object.fromEntries(
    [...SCALE_RULES].sort().map(rule => [
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
