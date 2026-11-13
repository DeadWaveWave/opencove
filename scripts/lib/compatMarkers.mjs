// Parsing for the compatibility registry check: `@compat` markers, typed `compat:` anchors and
// the unmarked compatibility signals that the ratchet counts. Pure functions over source text.
import ts from 'typescript'

export const SIGNAL_RULES = ['keyword', 'storage-prefix', 'client-features']

const MARKER_PATTERN = /^\s*\/\/\s*@compat(-file)?(?![\w-])(.*)$/
const MARKER_ID_PATTERN = /^\s+([a-z0-9][a-z0-9-]*)(?:\s.*)?$/
const FILE_MARKER_MAX_LINE = 5

// `compat` only counts as a word and `backward` only next to `compat`, so ordinary prose such as
// "compatible" or a "backward" direction is not a signal.
const SIGNAL_PATTERNS = [
  { rule: 'keyword', pattern: /legacy|deprecated|backwards?[ -]?compat/gi },
  { rule: 'keyword', pattern: /[Cc]ompat(?:ibility)?(?![a-z])/g },
  { rule: 'storage-prefix', pattern: /(?<![a-zA-Z0-9_])cove:m0:/gi },
  { rule: 'client-features', pattern: /\bclientFeatures\??\./g },
]

function scriptKindFor(path) {
  return path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
}

function lineOf(sourceFile, position) {
  return sourceFile.getLineAndCharacterOfPosition(position).line + 1
}

// The outermost node that starts exactly at `position`: the statement or member a marker covers.
function outermostNodeAt(sourceFile, position) {
  let found = null
  const visit = node => {
    if (node.getStart(sourceFile) === position && node.kind !== ts.SyntaxKind.SyntaxList) {
      if (!found || node.getEnd() > found.getEnd()) {
        found = node
      }
    }
    if (node.getStart(sourceFile) <= position && position < node.getEnd()) {
      ts.forEachChild(node, visit)
    }
  }
  ts.forEachChild(sourceFile, visit)
  return found
}

function skipTrivia(text, position) {
  let index = position
  for (;;) {
    while (index < text.length && /\s/.test(text[index])) {
      index += 1
    }
    if (text.startsWith('/*', index)) {
      const end = text.indexOf('*/', index + 2)
      index = end === -1 ? text.length : end + 2
    } else if (text.startsWith('//', index)) {
      const end = text.indexOf('\n', index)
      index = end === -1 ? text.length : end + 1
    } else {
      return index
    }
  }
}

function collectAnchors(sourceFile) {
  const anchors = []
  const visit = node => {
    if (
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'compat' &&
      (ts.isStringLiteral(node.initializer) ||
        ts.isNoSubstitutionTemplateLiteral(node.initializer)) &&
      ts.isObjectLiteralExpression(node.parent)
    ) {
      const literal = node.parent
      const covered =
        ts.isCallExpression(literal.parent) && literal.parent.arguments.includes(literal)
          ? literal.parent
          : literal
      anchors.push({
        id: node.initializer.text,
        line: lineOf(sourceFile, node.getStart(sourceFile)),
        start: covered.getStart(sourceFile),
        end: covered.getEnd(),
      })
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return anchors
}

function collectMarkers(sourceFile, text, problems) {
  const markers = []
  const markerLines = new Set()
  const lines = text.split('\n')
  let offset = 0
  for (const [index, line] of lines.entries()) {
    const lineNumber = index + 1
    const lineStart = offset
    offset += line.length + 1
    const match = MARKER_PATTERN.exec(line.replace(/\r$/, ''))
    if (!match) {
      continue
    }
    markerLines.add(lineNumber)
    const isFile = Boolean(match[1])
    const idMatch = MARKER_ID_PATTERN.exec(match[2])
    if (!idMatch) {
      problems.push({
        line: lineNumber,
        message: `\`@compat${isFile ? '-file' : ''}\` needs a registry id, for example \`// @compat${isFile ? '-file' : ''} some-id\`.`,
      })
      continue
    }
    const id = idMatch[1]
    if (isFile) {
      if (lineNumber > FILE_MARKER_MAX_LINE) {
        problems.push({
          line: lineNumber,
          id,
          message: `\`@compat-file ${id}\` must sit within the first ${FILE_MARKER_MAX_LINE} lines of the file.`,
        })
        continue
      }
      markers.push({ id, line: lineNumber, start: 0, end: text.length, file: true })
      continue
    }
    const afterLine = lineStart + line.length + 1
    const position = skipTrivia(text, afterLine)
    const node = position < text.length ? outermostNodeAt(sourceFile, position) : null
    if (!node || /\n[ \t\r]*\n/.test(text.slice(afterLine - 1, position))) {
      problems.push({
        line: lineNumber,
        id,
        message: `\`@compat ${id}\` must sit directly above the declaration or statement it covers.`,
      })
      continue
    }
    markers.push({ id, line: lineNumber, start: afterLine, end: node.getEnd(), file: false })
  }
  return { markers, markerLines }
}

function collectImportRanges(sourceFile) {
  return sourceFile.statements
    .filter(statement => ts.isImportDeclaration(statement))
    .map(statement => [statement.getStart(sourceFile), statement.getEnd()])
}

export function scanCompatSource(path, text) {
  const sourceFile = ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(path),
  )
  const problems = []
  const { markers, markerLines } = collectMarkers(sourceFile, text, problems)
  const anchors = collectAnchors(sourceFile)
  const covered = [...markers, ...anchors].map(entry => [entry.start, entry.end])
  const ignored = [...covered, ...collectImportRanges(sourceFile)]

  const signals = []
  for (const { rule, pattern } of SIGNAL_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const position = match.index
      const line = lineOf(sourceFile, position)
      if (markerLines.has(line)) {
        continue
      }
      if (ignored.some(([start, end]) => position >= start && position < end)) {
        continue
      }
      signals.push({ rule, line, position, text: match[0] })
    }
  }
  signals.sort((left, right) => left.line - right.line)
  return { markers, anchors, problems, signals }
}

export function hasFileMarker(scan) {
  return scan.markers.some(marker => marker.file)
}
