import { describe, expect, it, vi } from 'vitest'
import type { Terminal } from '@xterm/xterm'
import { registerOpenCodeOscColorQueryResponder } from '@/contexts/workspace/presentation/renderer/components/terminalNode/opencodeOscColorQueryResponder'

function createTerminalHarness(theme: Record<string, unknown>) {
  const handlers = new Map<number, (data: string) => boolean>()
  const parser = {
    registerOscHandler(identifier: number, callback: (data: string) => boolean) {
      if (this !== parser) {
        throw new Error('OSC handler registration lost parser context')
      }

      handlers.set(identifier, callback)
      return {
        dispose: () => {
          handlers.delete(identifier)
        },
      }
    },
  }
  const terminal = {
    options: { theme },
    parser,
  } as unknown as Terminal

  return { terminal, handlers }
}

describe('registerOpenCodeOscColorQueryResponder', () => {
  it('responds to OSC 4 palette queries', () => {
    const { terminal, handlers } = createTerminalHarness({
      background: '#0a0f1d',
      foreground: '#d6e4ff',
      cursor: '#d6e4ff',
      selectionBackground: 'rgba(94, 156, 255, 0.35)',
    })

    const ptyWriteQueue = { enqueue: vi.fn(), flush: vi.fn() }
    registerOpenCodeOscColorQueryResponder({ terminal, ptyWriteQueue })

    const handler = handlers.get(4)
    expect(handler).toBeTypeOf('function')
    expect(handler?.('0;?')).toBe(true)
    expect(ptyWriteQueue.enqueue).toHaveBeenCalledWith('\u001b]4;0;#000000\u0007')
    expect(ptyWriteQueue.flush).toHaveBeenCalled()
  })

  it('responds to OSC 10/11 special color queries using the active xterm theme', () => {
    const { terminal, handlers } = createTerminalHarness({
      background: '#fbfcff',
      foreground: 'rgba(17, 24, 39, 0.92)',
      cursor: 'rgba(17, 24, 39, 0.92)',
      selectionBackground: 'rgba(94, 156, 255, 0.24)',
    })

    const ptyWriteQueue = { enqueue: vi.fn(), flush: vi.fn() }
    registerOpenCodeOscColorQueryResponder({ terminal, ptyWriteQueue })

    expect(handlers.get(11)?.('?')).toBe(true)
    expect(ptyWriteQueue.enqueue).toHaveBeenCalledWith('\u001b]11;#fbfcff\u0007')

    expect(handlers.get(10)?.('?')).toBe(true)
    expect(ptyWriteQueue.enqueue).toHaveBeenCalledWith('\u001b]10;#111827\u0007')
  })
})
