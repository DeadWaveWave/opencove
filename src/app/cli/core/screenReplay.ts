import { CliError } from './errors'
import { screenTokens } from './screen/tokens'
import { cellWidth, graphemes } from './screen/width'
import type { PresentationSnapshotTerminalResult } from '../../../shared/contracts/dto'

type Screen = { cells: (string | null)[][]; x: number; y: number; wrap: boolean }
type Snapshot = Pick<
  PresentationSnapshotTerminalResult,
  'cols' | 'rows' | 'bufferKind' | 'serializedScreen'
>

/** A disposable text projection of the canonical snapshot, never a PTY or run-state owner. */
export function replayScreen(snapshot: Snapshot): string[] {
  const { cols, rows } = snapshot
  if (
    !Number.isSafeInteger(cols) ||
    !Number.isSafeInteger(rows) ||
    cols < 1 ||
    rows < 1 ||
    cols * rows > 1_000_000
  ) {
    throw new CliError('agent.screen_invalid', 5, 'Invalid terminal snapshot geometry.')
  }
  const blank = (): (string | null)[] => Array<string | null>(cols).fill(' ')
  const create = (): Screen => ({
    cells: Array.from({ length: rows }, blank),
    x: 0,
    y: 0,
    wrap: false,
  })
  const normal = create()
  let alternate: Screen | undefined
  let active = normal
  const clampX = (x: number) => Math.max(0, Math.min(cols - 1, x))
  const clampY = (y: number) => Math.max(0, Math.min(rows - 1, y))
  const lineFeed = () => {
    active.wrap = false
    if (active.y < rows - 1) {
      active.y++
    } else {
      active.cells.shift()
      active.cells.push(blank())
    }
  }
  const clearCell = (row: (string | null)[], x: number) => {
    if (row[x] === null && x > 0) {
      row[x - 1] = ' '
    }
    if (row[x + 1] === null) {
      row[x + 1] = ' '
    }
    row[x] = ' '
  }
  const erase = (y: number, start: number, end: number) => {
    for (let x = start; x <= end; x++) {
      clearCell(active.cells[y], x)
    }
  }
  const print = (text: string) => {
    const width = cellWidth(text)
    if (!width) {
      let x = active.wrap ? cols - 1 : active.x - 1
      while (x > 0 && active.cells[active.y][x] === null) {
        x--
      }
      if (x >= 0) {
        active.cells[active.y][x] += text
      }
      return
    }
    if (width > cols) {
      return
    }
    if (active.wrap || active.x + width > cols) {
      active.x = 0
      lineFeed()
    }
    const row = active.cells[active.y]
    for (let i = 0; i < width; i++) {
      clearCell(row, active.x + i)
    }
    row[active.x] = text
    if (width === 2) {
      row[active.x + 1] = null
    }
    active.wrap = active.x + width === cols
    active.x = Math.min(cols - 1, active.x + width)
  }
  for (const token of screenTokens(snapshot.serializedScreen)) {
    if (token.type === 'text') {
      for (const { segment } of graphemes(token.value)) {
        print(segment)
      }
    } else if (token.type === 'control') {
      if (['\n', '\v', '\f'].includes(token.value)) {
        lineFeed()
      } else if (token.value === '\r') {
        active.x = 0
        active.wrap = false
      } else if (token.value === '\b') {
        active.x = clampX(active.x - 1)
        active.wrap = false
      } else if (token.value === '\t') {
        active.x = clampX((Math.floor(active.x / 8) + 1) * 8)
        active.wrap = false
      }
    } else if ('params' in token) {
      if (/^\?[\d;]+$/.test(token.params)) {
        // The serializer concatenates normal + alternate content. Other DEC modes have no text effect.
        if (
          token.params
            .slice(1)
            .split(';')
            .some(p => ['47', '1047', '1049'].includes(p))
        ) {
          if (token.final === 'h') {
            alternate = create()
            active = alternate
          } else if (token.final === 'l') {
            active = normal
          }
        }
        continue
      }
      if (!/^[\d;]*$/.test(token.params)) {
        continue
      }
      const params = token.params.split(';').map(Number)
      const n = (i = 0, fallback = 1) => params[i] || fallback
      const { final } = token
      if ('ABCDEFGHfd'.includes(final)) {
        active.wrap = false
      }
      switch (final) {
        case 'A':
          active.y = clampY(active.y - n())
          break
        case 'B':
          active.y = clampY(active.y + n())
          break
        case 'C':
          active.x = clampX(active.x + n())
          break
        case 'D':
          active.x = clampX(active.x - n())
          break
        case 'E':
          active.y = clampY(active.y + n())
          active.x = 0
          break
        case 'F':
          active.y = clampY(active.y - n())
          active.x = 0
          break
        case 'G':
          active.x = clampX(n() - 1)
          break
        case 'H':
        case 'f':
          active.y = clampY(n() - 1)
          active.x = clampX(n(1) - 1)
          break
        case 'd':
          active.y = clampY(n() - 1)
          break
        case 'K': {
          const mode = n(0, 0)
          if ([0, 1, 2].includes(mode)) {
            erase(active.y, mode === 0 ? active.x : 0, mode === 1 ? active.x : cols - 1)
          }
          break
        }
        case 'J': {
          const mode = n(0, 0)
          if (mode === 0 || mode === 1) {
            erase(active.y, mode === 0 ? active.x : 0, mode === 1 ? active.x : cols - 1)
            for (let y = mode === 0 ? active.y + 1 : 0; y < (mode === 0 ? rows : active.y); y++) {
              erase(y, 0, cols - 1)
            }
          } else if (mode === 2) {
            active.cells = Array.from({ length: rows }, blank)
          }
          break
        }
      }
    }
  }
  const selected =
    snapshot.bufferKind === 'normal'
      ? normal
      : snapshot.bufferKind === 'alternate'
        ? (alternate ?? normal)
        : active
  const lines = selected.cells.map(row =>
    row
      .map(cell => cell ?? '')
      .join('')
      .replace(/ +$/, ''),
  )
  while (lines.length && !lines.at(-1)) {
    lines.pop()
  }
  return lines
}
