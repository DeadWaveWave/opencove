// Ratchet for the canvas state refactor in issue #647. Hooks under `workspaceCanvas/` share state
// through refs and setters passed from hook to hook, and many files write the workspace store. The
// counts below are per file, are compared for exact equality, and may only go down: a count that
// drops fails until the baseline is regenerated, so each improvement is locked in by its own change.
import ts from 'typescript'
import { compareRatchet, formatRatchetIssues, serializeRatchet } from './ratchet.mjs'

export const CANVAS_STATE_RULES = [
  'ref-type',
  'setter-type',
  'ref-write',
  'legacy-channel',
  'workspace-writer',
]

// Where each rule counts. A rule's scope is wider than the files that hold most of its occurrences
// today, so that moving code out of `workspaceCanvas/` cannot lower a count without removing the
// ref, setter or write. Later slices also add code outside `workspaceCanvas/`.
export const WORKSPACE_RENDERER_PREFIX = 'src/contexts/workspace/presentation/renderer/'
export const CANVAS_AREA_PREFIX = `${WORKSPACE_RENDERER_PREFIX}components/workspaceCanvas/`
export const RULE_SCOPES = {
  // The workspace context's renderer.
  'ref-type': WORKSPACE_RENDERER_PREFIX,
  'setter-type': WORKSPACE_RENDERER_PREFIX,
  'ref-write': WORKSPACE_RENDERER_PREFIX,
  // Every non-test source file under `src/`.
  'legacy-channel': 'src/',
  'workspace-writer': 'src/',
}

const IDENT = String.raw`[A-Za-z_$][\w$]*`
// Whitespace, including line breaks, may sit around `.` and `<` so that formatting never moves a
// count. All patterns run on source with comments and string contents removed.
const SPACE = String.raw`\s*`

// Each counter counts matches of one pattern. A match is one occurrence, not one line.
export const COUNTERS = {
  // `MutableRefObject<` or `RefObject<`, with or without a `React.` prefix. Type-only imports
  // (no `<`) are not counted. `MutableRefObject` is one match, not two.
  'ref-type': [new RegExp(String.raw`(?<![\w$])(?:Mutable)?RefObject${SPACE}<`, 'g')],
  // `Dispatch<SetStateAction`, with an optional `React.` prefix on either name.
  'setter-type': [
    new RegExp(
      String.raw`(?<![\w$])Dispatch${SPACE}<${SPACE}(?:${IDENT}${SPACE}\.${SPACE})?SetStateAction(?![\w$])`,
      'g',
    ),
  ],
  // An assignment to `.current` of an identifier named `ref` or ending in `Ref` (`xRef.current =`,
  // `params.nodesRef.current ||=`). Any assignment operator counts; `==`, `===` and `=>` do not.
  'ref-write': [
    new RegExp(
      String.raw`(?<![\w$])(?:ref|${IDENT}Ref)${SPACE}\.${SPACE}current${SPACE}(?:[-+*/%&|^]|\*\*|<<|>>>?|&&|\|\||\?\?)?=(?![=>])`,
      'g',
    ),
  ],
  // The whole-word identifiers `nodesRef`, `spacesRef`, `setNodes`, `onSpacesChange` and
  // `onRequestPersistFlush`, wherever they appear (declaration, parameter, field, call).
  'legacy-channel': [
    /(?<![\w$])(?:nodesRef|spacesRef|setNodes|onSpacesChange|onRequestPersistFlush)(?![\w$])/g,
  ],
  // Write-capability mentions: the whole-word identifier `setWorkspaces` (store field,
  // destructuring, parameter, call) and `useAppStore.setState`. Every mention counts once, whether
  // or not it is a call, because each one carries the ability to write the workspace list.
  'workspace-writer': [
    /(?<![\w$])setWorkspaces(?![\w$])/g,
    new RegExp(String.raw`(?<![\w$])useAppStore${SPACE}\.${SPACE}setState(?![\w$])`, 'g'),
  ],
}

// Names that stay visible when one is an entire quoted string, as in
// `Pick<Ctx, 'spacesRef' | 'setNodes'>` or `Params['nodesRef']`. They are type-level references to
// the same channel, so `legacy-channel` counts them.
const LEGACY_CHANNEL_NAMES = new Set([
  'nodesRef',
  'spacesRef',
  'setNodes',
  'onSpacesChange',
  'onRequestPersistFlush',
])

// Replaces every comment, string, template text, regular expression and JSX text token with
// spaces, keeping line breaks, so words inside them never count. The tokens come from the
// TypeScript parser, so a backtick in a regex literal or in JSX text cannot start a template and a
// `/` is read as a regex or a division by its position. Template `${...}` expressions stay code.
// A string whose whole value is one of the legacy channel names stays visible (see above).
export function blankNonCode(source, filePath = 'source.ts') {
  const kind = /\.tsx$/.test(filePath) ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, false, kind)
  const ranges = []
  const seenComments = new Set()

  const blankToken = node => ranges.push([node.getStart(sourceFile), node.end])
  const collectComments = position => {
    // Comments on the same line after a token are trailing, the others are leading.
    const found = [
      ...(ts.getLeadingCommentRanges(source, position) ?? []),
      ...(ts.getTrailingCommentRanges(source, position) ?? []),
    ]
    for (const comment of found) {
      if (!seenComments.has(comment.pos)) {
        seenComments.add(comment.pos)
        ranges.push([comment.pos, comment.end])
      }
    }
  }

  const visit = node => {
    collectComments(node.pos)
    collectComments(node.end)
    switch (node.kind) {
      case ts.SyntaxKind.StringLiteral:
        if (!LEGACY_CHANNEL_NAMES.has(node.text)) {
          blankToken(node)
        }
        return
      case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
      case ts.SyntaxKind.TemplateHead:
      case ts.SyntaxKind.TemplateMiddle:
      case ts.SyntaxKind.TemplateTail:
      case ts.SyntaxKind.RegularExpressionLiteral:
      case ts.SyntaxKind.JsxText:
        blankToken(node)
        return
      default:
    }
    for (const child of node.getChildren(sourceFile)) {
      if (child.kind >= ts.SyntaxKind.FirstJSDocNode && child.kind <= ts.SyntaxKind.LastJSDocNode) {
        continue
      }
      visit(child)
    }
  }
  visit(sourceFile)

  const text = source
  let out = ''
  let cursor = 0
  for (const [start, end] of ranges.sort((left, right) => left[0] - right[0])) {
    if (end <= cursor) {
      continue
    }
    const from = Math.max(start, cursor)
    out += text.slice(cursor, from) + text.slice(from, end).replace(/[^\r\n]/g, ' ')
    cursor = end
  }
  return out + text.slice(cursor)
}

export function normalizeRepoPath(filePath) {
  return filePath.replaceAll('\\', '/')
}

export function isCountedSourcePath(filePath) {
  const path = normalizeRepoPath(filePath)
  return (
    path.startsWith('src/') &&
    /\.(?:ts|tsx)$/.test(path) &&
    !/\.d\.ts$/.test(path) &&
    !/\.(?:spec|test)\.tsx?$/.test(path) &&
    !/(?:^|\/)__tests__\//.test(path)
  )
}

export function isInRuleScope(rule, filePath) {
  return normalizeRepoPath(filePath).startsWith(RULE_SCOPES[rule])
}

export function countOccurrences(source, patterns) {
  let total = 0
  for (const pattern of patterns) {
    total += [...source.matchAll(pattern)].length
  }
  return total
}

// `files` is `[{ path, content }]` with repository-relative paths. Test files are skipped.
export function countCanvasState(files) {
  const counts = Object.fromEntries(CANVAS_STATE_RULES.map(rule => [rule, {}]))
  for (const file of files) {
    const path = normalizeRepoPath(file.path)
    if (!isCountedSourcePath(path)) {
      continue
    }
    const source = blankNonCode(file.content ?? '', path)
    for (const rule of CANVAS_STATE_RULES) {
      if (!isInRuleScope(rule, path)) {
        continue
      }
      const count = countOccurrences(source, COUNTERS[rule])
      if (count > 0) {
        counts[rule][path] = count
      }
    }
  }
  return counts
}

export function totalOf(byFile = {}) {
  return Object.values(byFile).reduce((sum, count) => sum + count, 0)
}

export function totalsOf(counts) {
  return Object.fromEntries(CANVAS_STATE_RULES.map(rule => [rule, totalOf(counts[rule])]))
}

export function compareCanvasStateRatchet(counts, baseline) {
  return compareRatchet({
    counts,
    baseline,
    rules: CANVAS_STATE_RULES,
    describe: (rule, now, before) =>
      now > before
        ? `${now} \`${rule}\` occurrence(s), ${now - before} more than the baseline of ${before}. Use the canvas state owners described in DEVELOPMENT.md instead of adding refs, setters or workspace write mentions.`
        : `${now} \`${rule}\` occurrence(s), below the baseline of ${before}. Run \`pnpm canvas:state-ratchet\` and commit \`scripts/canvas-state-ratchet.json\` to lock in the improvement.`,
  })
}

export function formatCanvasStateIssues(issues) {
  return formatRatchetIssues(issues, {
    label: 'canvas-state-check',
    title: 'Canvas state ratchet',
    footer: 'See "Canvas state ratchet" in DEVELOPMENT.md (issue #647).',
  })
}

export function serializeCanvasStateRatchet(counts) {
  return serializeRatchet(counts, CANVAS_STATE_RULES)
}
