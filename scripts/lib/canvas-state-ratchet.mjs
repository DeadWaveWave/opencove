// Ratchet for the canvas state refactor in issue #647. Hooks under `workspaceCanvas/` share state
// through refs and setters passed from hook to hook, and many files write the workspace store. The
// counts below are per file, are compared for exact equality, and may only go down: a count that
// drops fails until the baseline is regenerated, so each improvement is locked in by its own change.
import { compareRatchet, formatRatchetIssues, serializeRatchet } from './ratchet.mjs'

export const CANVAS_STATE_RULES = [
  'ref-type',
  'setter-type',
  'ref-write',
  'legacy-channel',
  'workspace-writer',
]

// Rules counted in the canvas area: `workspaceCanvas/**` and `WorkspaceCanvasInner.tsx`.
export const CANVAS_AREA_RULES = ['ref-type', 'setter-type', 'ref-write', 'legacy-channel']
// Rules counted in every non-test source file under `src/`.
export const REPO_WIDE_RULES = ['workspace-writer']

export const CANVAS_AREA_PREFIX =
  'src/contexts/workspace/presentation/renderer/components/workspaceCanvas/'
export const CANVAS_INNER_FILE =
  'src/contexts/workspace/presentation/renderer/components/WorkspaceCanvasInner.tsx'

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
  // The whole-word identifier `setWorkspaces` (store field, destructuring, parameter, call) and
  // `useAppStore.setState`. Every write path into the workspace list counts once per mention.
  'workspace-writer': [
    /(?<![\w$])setWorkspaces(?![\w$])/g,
    new RegExp(String.raw`(?<![\w$])useAppStore${SPACE}\.${SPACE}setState(?![\w$])`, 'g'),
  ],
}

// Replaces comments and the contents of string and template literals with spaces (keeping line
// breaks), so that words inside them never count. Template `${...}` expressions stay code. This is
// a scanner, not a parser: a quote inside a regex literal or JSX text can hide the rest of that
// line, and an unterminated `'` or `"` string ends at the line break.
export function stripCommentsAndStrings(source) {
  let out = ''
  let index = 0
  const templateDepths = []
  let braceDepth = 0
  const blank = text => text.replace(/[^\r\n]/g, ' ')

  const readTemplateText = () => {
    // Called just after a backtick or a closing `}` of a `${}`; consumes template text.
    let text = ''
    while (index < source.length) {
      const char = source[index]
      if (char === '\\') {
        text += source.slice(index, index + 2)
        index += 2
      } else if (char === '`') {
        index += 1
        out += blank(text) + '`'
        return
      } else if (char === '$' && source[index + 1] === '{') {
        index += 2
        out += blank(text) + '${'
        templateDepths.push(braceDepth)
        braceDepth = 0
        return
      } else {
        text += char
        index += 1
      }
    }
    out += blank(text)
  }

  while (index < source.length) {
    const char = source[index]
    const next = source[index + 1]
    if (char === '/' && next === '/') {
      const end = source.slice(index).search(/\r|\n/)
      const stop = end === -1 ? source.length : index + end
      out += blank(source.slice(index, stop))
      index = stop
    } else if (char === '/' && next === '*') {
      const end = source.indexOf('*/', index + 2)
      const stop = end === -1 ? source.length : end + 2
      out += blank(source.slice(index, stop))
      index = stop
    } else if (char === "'" || char === '"') {
      let stop = index + 1
      while (stop < source.length && source[stop] !== char && !/[\r\n]/.test(source[stop])) {
        stop += source[stop] === '\\' ? 2 : 1
      }
      const closed = source[stop] === char
      out += char + blank(source.slice(index + 1, stop)) + (closed ? char : '')
      index = closed ? stop + 1 : stop
    } else if (char === '`') {
      index += 1
      out += '`'
      readTemplateText()
    } else if (char === '{' && templateDepths.length > 0) {
      braceDepth += 1
      out += char
      index += 1
    } else if (char === '}' && templateDepths.length > 0) {
      index += 1
      if (braceDepth === 0) {
        out += '}'
        braceDepth = templateDepths.pop()
        readTemplateText()
      } else {
        braceDepth -= 1
        out += '}'
      }
    } else {
      out += char
      index += 1
    }
  }
  return out
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

export function isCanvasAreaPath(filePath) {
  const path = normalizeRepoPath(filePath)
  return path.startsWith(CANVAS_AREA_PREFIX) || path === CANVAS_INNER_FILE
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
    const source = stripCommentsAndStrings(file.content ?? '')
    const rules = [...REPO_WIDE_RULES, ...(isCanvasAreaPath(path) ? CANVAS_AREA_RULES : [])]
    for (const rule of rules) {
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
        ? `${now} \`${rule}\` occurrence(s), ${now - before} more than the baseline of ${before}. Use the canvas state owners described in DEVELOPMENT.md instead of adding refs, setters or store writes.`
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

// The baseline may be rewritten freely except that no counter may gain occurrences in total.
// `baseline` is `null` only when the file does not exist yet (first generation).
export function planCanvasStateUpdate({ counts, baseline }) {
  const refusals = []
  if (baseline) {
    for (const rule of CANVAS_STATE_RULES) {
      const before = totalOf(baseline[rule])
      const after = totalOf(counts[rule])
      if (after > before) {
        refusals.push({ rule, before, after })
      }
    }
  }
  if (refusals.length > 0) {
    return { ok: false, refusals, serialized: null }
  }
  return { ok: true, refusals, serialized: serializeCanvasStateRatchet(counts) }
}
