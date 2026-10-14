import { describe, expect, it, vi } from 'vitest'
import type { Terminal } from '@xterm/xterm'
import { registerOpenCodeOscColorQueryResponder } from '@/contexts/workspace/presentation/renderer/components/terminalNode/opencodeOscColorQueryResponder'
import type { TerminalAppearanceSnapshot } from '@/contexts/workspace/presentation/renderer/components/terminalNode/terminalAppearance'

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
  it('answers palette queries from the applied ANSI snapshot and resets to the legacy fallback', () => {
    const { terminal, handlers } = createTerminalHarness({ red: '#ff0000' })
    const ptyWriteQueue = { enqueue: vi.fn(), flush: vi.fn() }
    let appliedAppearance: TerminalAppearanceSnapshot = {
      revision: 1,
      themeId: 'pixel-light',
      uiScheme: 'light',
      terminalScheme: 'light',
      xtermTheme: {
        background: '#f8fbfd',
        foreground: '#243c50',
        cursor: '#243c50',
        selectionBackground: '#dce8f2',
        red: '#934d5a',
        brightWhite: '#697480',
      },
      cssTokens: {},
    }
    registerOpenCodeOscColorQueryResponder({
      terminal,
      ptyWriteQueue,
      getAppliedAppearance: () => appliedAppearance,
    })
    expect(handlers.get(4)?.('1;?')).toBe(true)
    expect(ptyWriteQueue.enqueue).toHaveBeenLastCalledWith('\u001b]4;1;#934d5a\u0007')
    expect(handlers.get(4)?.('15;?')).toBe(true)
    expect(ptyWriteQueue.enqueue).toHaveBeenLastCalledWith('\u001b]4;15;#697480\u0007')
    appliedAppearance = {
      ...appliedAppearance,
      revision: 2,
      themeId: 'pixel',
      terminalScheme: 'dark',
      xtermTheme: {
        background: '#0a1420',
        foreground: '#c9d9e9',
        cursor: '#9ecefa',
        selectionBackground: '#233b5c',
      },
    }
    expect(handlers.get(4)?.('1;?')).toBe(true)
    expect(ptyWriteQueue.enqueue).toHaveBeenLastCalledWith('\u001b]4;1;#cd0000\u0007')
    expect(handlers.get(4)?.('16;?')).toBe(false)
    expect(handlers.get(4)?.('-1;?')).toBe(false)
  })

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
    const appliedAppearance = {
      revision: 7,
      themeId: 'light',
      uiScheme: 'light',
      terminalScheme: 'light',
      xtermTheme: terminal.options.theme,
      cssTokens: {},
    } as TerminalAppearanceSnapshot
    registerOpenCodeOscColorQueryResponder({
      terminal,
      ptyWriteQueue,
      getAppliedAppearance: () => appliedAppearance,
    })

    expect(handlers.get(11)?.('?')).toBe(true)
    expect(ptyWriteQueue.enqueue).toHaveBeenCalledWith('\u001b]11;#fbfcff\u0007')

    expect(handlers.get(10)?.('?')).toBe(true)
    expect(ptyWriteQueue.enqueue).toHaveBeenCalledWith('\u001b]10;#111827\u0007')
  })

  it('answers OSC from the applied snapshot instead of a newer desired or stale terminal option', () => {
    const { terminal, handlers } = createTerminalHarness({
      background: '#stale',
      foreground: '#stale',
    })
    const ptyWriteQueue = { enqueue: vi.fn(), flush: vi.fn() }
    const appliedAppearance = {
      revision: 3,
      themeId: 'light',
      uiScheme: 'light',
      terminalScheme: 'dark',
      xtermTheme: {
        background: '#15110e',
        foreground: '#d4c4ae',
        cursor: '#d4c4ae',
        selectionBackground: 'rgba(94, 156, 255, 0.35)',
      },
      cssTokens: {},
    } satisfies TerminalAppearanceSnapshot

    registerOpenCodeOscColorQueryResponder({
      terminal,
      ptyWriteQueue,
      getAppliedAppearance: () => appliedAppearance,
    })

    expect(handlers.get(11)?.('?')).toBe(true)
    expect(ptyWriteQueue.enqueue).toHaveBeenCalledWith('\u001b]11;#15110e\u0007')
    expect(handlers.get(10)?.('?')).toBe(true)
    expect(ptyWriteQueue.enqueue).toHaveBeenCalledWith('\u001b]10;#d4c4ae\u0007')
  })
})
