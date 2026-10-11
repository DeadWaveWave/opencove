import type { IBuffer, IBufferLine, IBufferRange, Terminal } from '@xterm/xterm'

export const MAX_TERMINAL_LINK_ROWS = 200
export const MAX_TERMINAL_LINK_CHARACTERS = 20_000

interface TerminalLinkRow {
  row: number
  startIndex: number
  text: string
  starts: number[]
  ends: number[]
}

export interface TerminalLinkSnapshot {
  text: string
  rows: TerminalLinkRow[]
  startRow: number
  endRow: number
  cols: number
  bufferType: IBuffer['type']
  fingerprint: string
}

export type TerminalLinkTarget =
  | { kind: 'url'; uri: string }
  | {
      kind: 'file'
      path: string
      line?: number
      column?: number
      lineEnd?: number
      columnEnd?: number
    }

export interface TerminalDetectedLink {
  text: string
  range: IBufferRange
  target: TerminalLinkTarget
  snapshot: TerminalLinkSnapshot
}

export interface TerminalLinkProviderOptions {
  onActivate?: (event: MouseEvent, link: TerminalDetectedLink) => void
}

function readRow(
  line: IBufferLine,
  row: number,
  startIndex: number,
  continuation: IBufferLine | undefined,
): TerminalLinkRow | null {
  let text = ''
  const starts: number[] = []
  const ends: number[] = []
  const length = continuation ? line.length : line.translateToString(true).length
  let lastContentOffset = 0
  for (let column = 0; column < line.length; column++) {
    const cell = line.getCell(column)
    if (!cell) {
      return null
    }
    const width = cell.getWidth()
    if (width === 0) {
      continue
    }
    const chars = cell.getChars()
    // A wide cell wraps before the final empty column; that placeholder is not a space.
    if (column === line.length - 1 && !chars && continuation?.getCell(0)?.getWidth() === 2) {
      continue
    }
    const value = chars || ' '
    if (startIndex + text.length + value.length > MAX_TERMINAL_LINK_CHARACTERS) {
      return null
    }
    text += value
    for (let index = 0; index < value.length; index++) {
      starts.push(column + 1)
      ends.push(column + width)
    }
    if (chars) {
      lastContentOffset = text.length
    }
    if (!continuation && text.length >= length && column >= length) {
      break
    }
  }
  if (!continuation) {
    text = text.slice(0, lastContentOffset)
    starts.length = text.length
    ends.length = text.length
  }
  return { row, startIndex, text, starts, ends }
}

export function readTerminalLinkSnapshot(
  terminal: Terminal,
  bufferLineNumber: number,
): TerminalLinkSnapshot | null {
  const buffer = terminal.buffer.active
  let start = bufferLineNumber - 1
  let end = start
  if (!buffer.getLine(start)) {
    return null
  }
  while (start > 0 && buffer.getLine(start)?.isWrapped) {
    if (end - start + 1 >= MAX_TERMINAL_LINK_ROWS) {
      return null
    }
    start--
  }
  while (buffer.getLine(end + 1)?.isWrapped) {
    if (end - start + 1 >= MAX_TERMINAL_LINK_ROWS) {
      return null
    }
    end++
  }
  if (terminal.cols > MAX_TERMINAL_LINK_CHARACTERS) {
    return null
  }

  let text = ''
  const rows: TerminalLinkRow[] = []
  for (let index = start; index <= end; index++) {
    const line = buffer.getLine(index)
    if (!line) {
      return null
    }
    const row = readRow(
      line,
      index + 1,
      text.length,
      index < end ? buffer.getLine(index + 1) : undefined,
    )
    if (!row) {
      return null
    }
    rows.push(row)
    text += row.text
  }
  return {
    text,
    rows,
    startRow: start + 1,
    endRow: end + 1,
    cols: terminal.cols,
    bufferType: buffer.type,
    fingerprint: JSON.stringify([
      buffer.type,
      terminal.cols,
      start,
      rows.map(row => [row.text, row.starts, row.ends]),
    ]),
  }
}

export function terminalLinkRange(
  snapshot: TerminalLinkSnapshot,
  startIndex: number,
  endIndex: number,
): IBufferRange | null {
  if (startIndex < 0 || endIndex <= startIndex || endIndex > snapshot.text.length) {
    return null
  }
  const start = snapshot.rows.find(row => startIndex < row.startIndex + row.text.length)
  const end = snapshot.rows.find(row => endIndex - 1 < row.startIndex + row.text.length)
  if (!start || !end) {
    return null
  }
  return {
    start: { x: start.starts[startIndex - start.startIndex]!, y: start.row },
    end: { x: end.ends[endIndex - 1 - end.startIndex]!, y: end.row },
  }
}

export function isTerminalLinkSnapshotCurrent(
  terminal: Terminal,
  snapshot: TerminalLinkSnapshot,
): boolean {
  return readTerminalLinkSnapshot(terminal, snapshot.startRow)?.fingerprint === snapshot.fingerprint
}
