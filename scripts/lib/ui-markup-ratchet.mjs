// Ratchet for native markup that a shared component replaces. Existing uses are counted per file
// and the counts may only go down; new code uses the component. Rules join as components land.
import ts from 'typescript'
import { compareRatchet, formatRatchetIssues, serializeRatchet } from './ratchet.mjs'

export const MARKUP_RULES = ['native-button', 'native-checkbox', 'native-title']

const REPLACEMENT_HINTS = {
  'native-button':
    'Use `Button`, `IconButton` or `MenuItem` from components/ui instead of a native `<button>`.',
  'native-checkbox':
    'Use `Toggle`, `Checkbox` or `Chip` from components/ui instead of a native checkbox.',
  'native-title': 'Use `Tooltip` from components/ui instead of a native `title` attribute.',
}

// An iframe title names the frame for assistive technology; it is not a hover hint.
const TITLE_EXEMPT_TAGS = new Set(['iframe'])

// The shared components are where native buttons and checkboxes live.
const SHARED_COMPONENTS_DIRECTORY = 'src/app/renderer/components/ui/'

function hasStringAttribute(node, source, name, value) {
  return node.attributes.properties.some(
    attribute =>
      ts.isJsxAttribute(attribute) &&
      attribute.name.getText(source) === name &&
      attribute.initializer !== undefined &&
      ts.isStringLiteral(attribute.initializer) &&
      attribute.initializer.text === value,
  )
}

function isIntrinsicTag(tagName) {
  return /^[a-z]/.test(tagName)
}

export function countMarkupLiterals(files) {
  const counts = Object.fromEntries(MARKUP_RULES.map(rule => [rule, {}]))
  const increment = (rule, path) => {
    counts[rule][path] = (counts[rule][path] ?? 0) + 1
  }
  for (const file of files) {
    const countsControls = !file.path.startsWith(SHARED_COMPONENTS_DIRECTORY)
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
        if (countsControls && tagName === 'button') {
          increment('native-button', file.path)
        }
        if (
          countsControls &&
          tagName === 'input' &&
          hasStringAttribute(node, source, 'type', 'checkbox')
        ) {
          increment('native-checkbox', file.path)
        }
        if (isIntrinsicTag(tagName) && !TITLE_EXEMPT_TAGS.has(tagName)) {
          for (const attribute of node.attributes.properties) {
            if (ts.isJsxAttribute(attribute) && attribute.name.getText(source) === 'title') {
              increment('native-title', file.path)
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
