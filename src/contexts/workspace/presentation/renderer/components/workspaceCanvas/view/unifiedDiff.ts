export type UnifiedDiffLineType = 'context' | 'add' | 'del' | 'meta'

export interface UnifiedDiffLine {
  type: UnifiedDiffLineType
  content: string
  oldLineNumber: number | null
  newLineNumber: number | null
}

export interface UnifiedDiffHunk {
  header: string
  lines: UnifiedDiffLine[]
}

export interface UnifiedDiffFile {
  key: string
  oldPath: string | null
  newPath: string | null
  path: string
  hunks: UnifiedDiffHunk[]
  addedLines: number
  deletedLines: number
  isBinary: boolean
}

export interface UnifiedDiffParseResult {
  files: UnifiedDiffFile[]
}

function normalizeDiffPath(raw: string): string | null {
  const trimmed = raw.trim()
  if (trimmed.length === 0) {
    return null
  }

  if (trimmed === '/dev/null') {
    return null
  }

  return trimmed.replace(/^[ab]\//, '')
}

function parseHunkHeader(line: string): { oldStart: number; newStart: number } | null {
  const match = line.match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/)
  if (!match) {
    return null
  }

  const oldStart = Number(match[1] ?? '')
  const newStart = Number(match[3] ?? '')

  if (!Number.isFinite(oldStart) || !Number.isFinite(newStart)) {
    return null
  }

  return { oldStart, newStart }
}

export function parseUnifiedDiff(diff: string): UnifiedDiffParseResult {
  const files: UnifiedDiffFile[] = []

  let currentFile: UnifiedDiffFile | null = null
  let currentHunk: UnifiedDiffHunk | null = null
  let oldLine = 0
  let newLine = 0

  const pushCurrentFile = (): void => {
    if (currentFile) {
      files.push(currentFile)
    }
    currentFile = null
    currentHunk = null
  }

  const lines = diff.split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''

    if (line.startsWith('diff --git ')) {
      pushCurrentFile()

      const match = line.match(/^diff --git a\/(.*?) b\/(.*?)$/)
      const oldPath = match?.[1] ? normalizeDiffPath(`a/${match[1]}`) : null
      const newPath = match?.[2] ? normalizeDiffPath(`b/${match[2]}`) : null
      const path = newPath ?? oldPath ?? '(unknown)'

      currentFile = {
        key: `${path}:${files.length}`,
        oldPath,
        newPath,
        path,
        hunks: [],
        addedLines: 0,
        deletedLines: 0,
        isBinary: false,
      }
      continue
    }

    if (!currentFile) {
      continue
    }

    if (line.startsWith('--- ')) {
      const oldPath = normalizeDiffPath(line.slice(4))
      if (oldPath) {
        currentFile.oldPath = oldPath
      }
      continue
    }

    if (line.startsWith('+++ ')) {
      const newPath = normalizeDiffPath(line.slice(4))
      if (newPath) {
        currentFile.newPath = newPath
        currentFile.path = newPath
      }
      continue
    }

    if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) {
      currentFile.isBinary = true
      continue
    }

    if (line.startsWith('@@')) {
      const parsedHeader = parseHunkHeader(line)
      if (!parsedHeader) {
        continue
      }

      oldLine = parsedHeader.oldStart
      newLine = parsedHeader.newStart
      currentHunk = { header: line, lines: [] }
      currentFile.hunks.push(currentHunk)
      continue
    }

    if (!currentHunk) {
      continue
    }

    if (line.startsWith('+') && !line.startsWith('+++')) {
      currentFile.addedLines += 1
      currentHunk.lines.push({
        type: 'add',
        content: line.slice(1),
        oldLineNumber: null,
        newLineNumber: newLine,
      })
      newLine += 1
      continue
    }

    if (line.startsWith('-') && !line.startsWith('---')) {
      currentFile.deletedLines += 1
      currentHunk.lines.push({
        type: 'del',
        content: line.slice(1),
        oldLineNumber: oldLine,
        newLineNumber: null,
      })
      oldLine += 1
      continue
    }

    if (line.startsWith(' ')) {
      currentHunk.lines.push({
        type: 'context',
        content: line.slice(1),
        oldLineNumber: oldLine,
        newLineNumber: newLine,
      })
      oldLine += 1
      newLine += 1
      continue
    }

    if (line.startsWith('\\ No newline at end of file')) {
      currentHunk.lines.push({
        type: 'meta',
        content: line,
        oldLineNumber: null,
        newLineNumber: null,
      })
      continue
    }
  }

  pushCurrentFile()

  return { files }
}
