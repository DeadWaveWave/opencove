import { describe, expect, it } from 'vitest'
import { Terminal } from '@xterm/xterm'
import {
  resizeTerminalWithWindowsConptyScrollbackReflow,
  shouldForceWindowsConptyResizeReflow,
} from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/terminalWindowsPtyReflow'

const LONG_LINE = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

async function writeTerminalAsync(terminal: Terminal, data: string): Promise<void> {
  await new Promise<void>(resolve => {
    terminal.write(data, resolve)
  })
}

function readBufferLines(terminal: Terminal): string[] {
  return Array.from(
    { length: terminal.buffer.active.length },
    (_, index) => terminal.buffer.active.getLine(index)?.translateToString(true) ?? '',
  )
}

describe('Windows ConPTY terminal scrollback reflow', () => {
  it('forces resize reflow for old ConPTY scrollback while preserving the reported PTY metadata', async () => {
    const terminal = new Terminal({
      cols: 10,
      rows: 3,
      scrollback: 100,
      convertEol: true,
      windowsPty: {
        backend: 'conpty',
        buildNumber: 19045,
      },
    })

    await writeTerminalAsync(terminal, `${LONG_LINE}\r\n${LONG_LINE}\r\n${LONG_LINE}\r\n`)

    expect(readBufferLines(terminal)).toContain('abcdefghij')
    expect(readBufferLines(terminal)).not.toContain('abcdefghijklmnopqrst')

    resizeTerminalWithWindowsConptyScrollbackReflow(terminal, 20, 3)

    expect(readBufferLines(terminal)).toContain('abcdefghijklmnopqrst')
    expect(readBufferLines(terminal)).not.toContain('abcdefghij')
    expect(terminal.options.windowsPty).toEqual({
      backend: 'conpty',
      buildNumber: 19045,
    })
  })

  it('does not force reflow for modern ConPTY builds', () => {
    expect(shouldForceWindowsConptyResizeReflow({ backend: 'conpty', buildNumber: 21376 })).toBe(
      false,
    )
    expect(shouldForceWindowsConptyResizeReflow({ backend: 'conpty', buildNumber: 22631 })).toBe(
      false,
    )
  })
})
