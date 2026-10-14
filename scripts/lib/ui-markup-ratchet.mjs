// Ratchet for native markup that a shared component replaces. Existing uses are counted per file
// and the counts may only go down; new code uses the component. Rules join as components land.
import ts from 'typescript'
import { compareRatchet, formatRatchetIssues, serializeRatchet } from './ratchet.mjs'

export const MARKUP_RULES = ['native-title']

const REPLACEMENT_HINTS = {
  'native-title': 'Use `Tooltip` from components/ui instead of a native `title` attribute.',
}

// An iframe title names the frame for assistive technology; it is not a hover hint.
const TITLE_EXEMPT_TAGS = new Set(['iframe'])

function isIntrinsicTag(tagName) {
  return /^[a-z]/.test(tagName)
}

export function countMarkupLiterals(files) {
  const counts = Object.fromEntries(MARKUP_RULES.map(rule => [rule, {}]))
  for (const file of files) {
    const source = ts.createSourceFile(
      file.path,
      file.content,
      ts.ScriptTarget.Latest,
      false,
      ts.ScriptKind.TSX,
    )
    const visit = node => {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tagName = node.tagName.getText(source)
        if (isIntrinsicTag(tagName) && !TITLE_EXEMPT_TAGS.has(tagName)) {
          for (const attribute of node.attributes.properties) {
            if (ts.isJsxAttribute(attribute) && attribute.name.getText(source) === 'title') {
              counts['native-title'][file.path] = (counts['native-title'][file.path] ?? 0) + 1
            }
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  return counts
}

export function compareMarkupRatchet(counts, baseline) {
  return compareRatchet({
    counts,
    baseline,
    rules: MARKUP_RULES,
    describe: (rule, now, before) =>
      now > before
        ? `${now} ${rule} uses, ${now - before} more than the baseline. ${REPLACEMENT_HINTS[rule]}`
        : `${now} ${rule} uses, below the baseline of ${before}. Run \`pnpm ui:style-ratchet\` to lock in the improvement.`,
  })
}

export function formatMarkupRatchetIssues(issues) {
  return formatRatchetIssues(issues, {
    title: 'Markup ratchet',
    footer: 'See docs/ui/README.md §3.4 for the shared components that replace native markup.',
  })
}

export function serializeMarkupRatchet(counts) {
  return serializeRatchet(counts, MARKUP_RULES)
}
