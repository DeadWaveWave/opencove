// Ratchet for hard-coded scale values in renderer CSS. New code uses the --cove-* scale tokens;
// existing values are counted per file and the counts may only go down.
import { compareRatchet, formatRatchetIssues, serializeRatchet } from './ratchet.mjs'

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
  return compareRatchet({
    counts,
    baseline,
    rules: SCALE_RULES,
    describe: (rule, now, before) =>
      now > before
        ? `${now} hard-coded ${rule} values, ${now - before} more than the baseline. Use \`${TOKEN_HINTS[rule]}\` tokens.`
        : `${now} hard-coded ${rule} values, below the baseline of ${before}. Run \`pnpm ui:style-ratchet\` to lock in the improvement.`,
  })
}

export function formatScaleRatchetIssues(issues) {
  return formatRatchetIssues(issues, {
    title: 'Scale ratchet',
    footer: 'See docs/ui/README.md for the scale tokens and the ratchet.',
  })
}

export function serializeScaleRatchet(counts) {
  return serializeRatchet(counts, SCALE_RULES)
}
