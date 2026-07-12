import { describe, expect, it, vi } from 'vitest'
import { SearchAddon } from '@xterm/addon-search'
import { Terminal } from '@xterm/xterm'
import {
  rebuildTerminalFindDecorations,
  resolveTerminalFindDecorations,
} from '@/contexts/workspace/presentation/renderer/components/terminalNode/useTerminalFind'

describe('terminal find decorations', () => {
  it('uses terminal appearance scheme rather than the surrounding UI scheme', () => {
    expect(resolveTerminalFindDecorations('dark').matchBackground).toBe('#18284a')
    expect(resolveTerminalFindDecorations('light').matchBackground).toBe('#d6e8ff')
  })

  it('rebuilds decorations without changing the active match or viewport', () => {
    const selection = {
      start: { x: 4, y: 8 },
      end: { x: 9, y: 8 },
    }
    const terminal = {
      cols: 80,
      buffer: { active: { viewportY: 6 } },
      getSelectionPosition: vi.fn(() => selection),
      select: vi.fn(),
      scrollToLine: vi.fn(),
    } as unknown as Terminal
    const addon = {
      clearDecorations: vi.fn(),
      findNext: vi.fn(() => true),
    } as unknown as SearchAddon

    const result = rebuildTerminalFindDecorations({
      terminal,
      addon,
      term: 'alpha',
      options: {
        caseSensitive: false,
        regex: false,
        decorations: resolveTerminalFindDecorations('dark'),
      },
    })

    expect(result).toBe(true)
    expect(addon.clearDecorations).toHaveBeenCalledTimes(1)
    expect(addon.findNext).toHaveBeenCalledWith(
      'alpha',
      expect.objectContaining({ incremental: true }),
    )
    expect(terminal.select).toHaveBeenCalledWith(4, 8, 5)
    expect(terminal.scrollToLine).toHaveBeenCalledWith(6)
  })

  it('preserves the selected result in the pinned SearchAddon implementation', async () => {
    const container = document.createElement('div')
    container.style.width = '640px'
    container.style.height = '320px'
    document.body.append(container)

    const terminal = new Terminal({ cols: 24, rows: 4, allowProposedApi: true })
    const addon = new SearchAddon()
    let activeResult = { resultIndex: 0, resultCount: 0 }
    terminal.open(container)
    terminal.loadAddon(addon)
    const resultsDisposable = addon.onDidChangeResults(result => {
      activeResult = result
    })
    await new Promise<void>(resolve => {
      terminal.write('zero alpha\r\none alpha\r\ntwo alpha', resolve)
    })

    expect(addon.findNext('alpha', { decorations: resolveTerminalFindDecorations('dark') })).toBe(
      true,
    )
    expect(addon.findNext('alpha', { decorations: resolveTerminalFindDecorations('dark') })).toBe(
      true,
    )
    const beforeSelection = terminal.getSelectionPosition()
    const beforeViewportY = terminal.buffer.active.viewportY
    const beforeResult = activeResult

    expect(
      rebuildTerminalFindDecorations({
        terminal,
        addon,
        term: 'alpha',
        options: {
          decorations: resolveTerminalFindDecorations('light'),
        },
      }),
    ).toBe(true)
    expect(terminal.getSelectionPosition()).toEqual(beforeSelection)
    expect(terminal.buffer.active.viewportY).toBe(beforeViewportY)
    expect(activeResult).toEqual(beforeResult)

    resultsDisposable.dispose()
    terminal.dispose()
    container.remove()
  })
})
