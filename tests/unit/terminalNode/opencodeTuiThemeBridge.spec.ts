import { describe, expect, it, vi } from 'vitest'
import type { Terminal } from '@xterm/xterm'
import { createOpenCodeTuiThemeBridge } from '@/contexts/workspace/presentation/renderer/components/terminalNode/opencodeTuiThemeBridge'

function createTerminalHarness() {
  const handlers = new Map<number, (data: string) => boolean>()
  const terminal = {
    options: { theme: {} },
    parser: {
      registerOscHandler: (identifier: number, callback: (data: string) => boolean) => {
        handlers.set(identifier, callback)
        return {
          dispose: () => {
            handlers.delete(identifier)
          },
        }
      },
    },
  } as unknown as Terminal

  return { terminal }
}

describe('createOpenCodeTuiThemeBridge', () => {
  it('reports theme mode when OpenCode enters alt screen (even when the sequence is chunked)', () => {
    document.documentElement.dataset.coveTheme = 'light'

    const { terminal } = createTerminalHarness()
    const ptyWriteQueue = { enqueue: vi.fn(), flush: vi.fn() }

    const bridge = createOpenCodeTuiThemeBridge({
      terminal,
      ptyWriteQueue,
      terminalThemeMode: 'sync-with-ui',
    })

    bridge.reportThemeMode()
    expect(ptyWriteQueue.enqueue).not.toHaveBeenCalled()

    bridge.handlePtyOutputChunk('\u001b[?104')
    bridge.handlePtyOutputChunk('9h')
    expect(ptyWriteQueue.enqueue).toHaveBeenCalledWith('\u001b[?997;2n')
    expect(ptyWriteQueue.flush).toHaveBeenCalled()

    bridge.reportThemeMode()
    expect(ptyWriteQueue.enqueue).toHaveBeenCalledTimes(1)

    document.documentElement.dataset.coveTheme = 'dark'
    bridge.reportThemeMode()
    expect(ptyWriteQueue.enqueue).toHaveBeenCalledWith('\u001b[?997;1n')

    bridge.handlePtyOutputChunk('\u001b[?1049l')
    document.documentElement.dataset.coveTheme = 'light'
    bridge.reportThemeMode()
    expect(ptyWriteQueue.enqueue).toHaveBeenCalledTimes(2)

    bridge.handlePtyOutputChunk('\u001b[?1049h')
    expect(ptyWriteQueue.enqueue).toHaveBeenCalledTimes(3)
    expect(ptyWriteQueue.enqueue).toHaveBeenLastCalledWith('\u001b[?997;2n')
  })
})
