import { describe, expect, it } from 'vitest'
import { Terminal } from '@xterm/xterm'
import { TerminalPresentationSession } from '../../../src/platform/terminal/presentation/TerminalPresentationSession'

const write = (terminal: Terminal, data: string) =>
  new Promise<void>(resolve => terminal.write(data, resolve))
const project = (terminal: Terminal) => ({
  cursor: [terminal.buffer.active.cursorX, terminal.buffer.active.cursorY],
  modes: terminal.modes,
  lines: Array.from({ length: terminal.buffer.active.length }, (_, row) =>
    terminal.buffer.active.getLine(row)?.translateToString(true),
  ),
  cells: Array.from({ length: terminal.rows }, (_, row) =>
    Array.from({ length: terminal.cols }, (_cell, col) => {
      const cell = terminal.buffer.active
        .getLine(terminal.buffer.active.viewportY + row)
        ?.getCell(col)
      return [
        cell?.getChars(),
        cell?.getWidth(),
        cell?.getFgColorMode(),
        cell?.getFgColor(),
        cell?.isBold(),
      ]
    }),
  ),
})
const cases = [false, true].flatMap(alternate =>
  [false, true].flatMap(origin =>
    [
      '1234567890',
      '12345678界',
      '123456789e\u0301',
      '\x1b[31;1m12345678界\x1b[32;22m',
      '1234567890\x1b[32m',
      '\x1b[31m1234567890\x1b[1m',
    ].map(text => ({ alternate, origin, text })),
  ),
)

describe('scroll margins and pending-wrap checkpoint continuation', () => {
  it.each(cases)('preserves pending wrap: %j', async ({ alternate, origin, text }) => {
    const grid = { cols: 10, rows: 5, allowProposedApi: true }
    const source = new Terminal(grid),
      restored = new Terminal(grid)
    const worker = new TerminalPresentationSession({ sessionId: 'wrap-margins', ...grid })
    try {
      const data =
        (alternate ? '\x1b[?1049h' : '') +
        '\x1b[2;4r' +
        (origin ? '\x1b[?6h\x1b[1;1H' : '\x1b[2;1H') +
        text
      await Promise.all([write(source, data), worker.applyOutput(1, data)])
      expect(source.buffer.active.cursorX).toBe(10)
      const snapshot = await worker.snapshot()
      // CUP is 1-based and cannot encode the pending-wrap column cols + 1.
      // eslint-disable-next-line no-control-regex -- inspect literal VT CUP coordinates
      const columns = Array.from(snapshot.serializedScreen.matchAll(/\x1b\[\d+;(\d+)H/gu), match =>
        Number(match[1]),
      )
      expect.soft(columns.every(column => column >= 1 && column <= grid.cols)).toBe(true)
      // eslint-disable-next-line no-control-regex -- inspect literal VT CUP rows
      const rows = Array.from(snapshot.serializedScreen.matchAll(/\x1b\[(\d+);\d+H/gu), match =>
        Number(match[1]),
      )
      expect.soft(rows.every(row => row >= 1 && row <= grid.rows)).toBe(true)
      await write(restored, snapshot.serializedScreen)
      expect(project(restored)).toEqual(project(source))
      await Promise.all([write(source, 'X'), write(restored, 'X')])
      expect(project(restored)).toEqual(project(source))
      await Promise.all([write(source, '界'.repeat(15)), write(restored, '界'.repeat(15))])
      expect(project(restored)).toEqual(project(source))
    } finally {
      source.dispose()
      restored.dispose()
      worker.dispose()
    }
  })
})
