import { describe, expect, it } from 'vitest'
import { readTerminalBufferTextForTest } from './terminalRenderTestProbe'

function fakeTerminal(rows: Array<{ text: string; isWrapped?: boolean }>) {
  return {
    rows: rows.length,
    buffer: {
      active: {
        viewportY: 0,
        length: rows.length,
        getLine: (line: number) =>
          rows[line]
            ? {
                isWrapped: rows[line].isWrapped ?? false,
                translateToString: (trimRight?: boolean) =>
                  trimRight ? rows[line].text.trimEnd() : rows[line].text,
              }
            : undefined,
      },
    },
  }
}

describe('readTerminalBufferTextForTest', () => {
  it('finds a marker that a soft wrap splits across rows, at the row where it starts', () => {
    const terminal = fakeTerminal([
      { text: '$ prompt' },
      { text: 'LONG_xxxxxxxx_VISI' },
      { text: 'BLE_END', isWrapped: true },
      { text: '$ ' },
    ])

    expect(readTerminalBufferTextForTest(terminal, 'VISIBLE_END')?.markerAbsoluteLine).toBe(1)
  })

  it('reports a marker on a wrapped continuation by its own row, as before', () => {
    const terminal = fakeTerminal([
      { text: 'LONG_xxxxxxxx' },
      { text: 'xx VISIBLE_END', isWrapped: true },
    ])

    expect(readTerminalBufferTextForTest(terminal, 'VISIBLE_END')?.markerAbsoluteLine).toBe(1)
  })

  it('does not join rows separated by a real line break', () => {
    const terminal = fakeTerminal([{ text: 'VISI' }, { text: 'BLE_END' }])

    expect(readTerminalBufferTextForTest(terminal, 'VISIBLE_END')?.markerAbsoluteLine).toBeNull()
  })
})
