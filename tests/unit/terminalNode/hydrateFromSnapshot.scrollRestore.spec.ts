import { describe, expect, it, vi } from 'vitest'
import { hydrateTerminalFromSnapshot } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/hydrateFromSnapshot'

describe('hydrateFromSnapshot scroll restore', () => {
  it('captures the current viewport before a live snapshot repair rewrites the terminal', async () => {
    const terminal = {
      cols: 80,
      rows: 24,
      buffer: {
        active: {
          baseY: 180,
          viewportY: 150,
        },
      },
      _core: {
        _bufferService: {
          isUserScrolling: true,
          buffer: {
            ydisp: 150,
          },
        },
        _viewport: {
          queueSync: vi.fn(),
          scrollToLine: vi.fn(),
        },
      },
      reset: vi.fn(() => {
        terminal.buffer.active.baseY = 0
        terminal.buffer.active.viewportY = 0
      }),
      scrollToLine: vi.fn(),
      resize: vi.fn(),
      write: vi.fn((data: string, callback?: () => void) => {
        if (data === 'LIVE_REPAIRED_SCREEN') {
          terminal.buffer.active.baseY = 210
          terminal.buffer.active.viewportY = 210
        }
        callback?.()
        return data
      }),
    }
    const finalizeHydration = vi.fn()

    await hydrateTerminalFromSnapshot({
      attachPromise: Promise.resolve(),
      sessionId: 'terminal-session-live-repair',
      terminal: terminal as never,
      kind: 'terminal',
      cachedScreenState: {
        sessionId: 'terminal-session-live-repair',
        serialized: 'CACHED_SCREEN',
        cols: 80,
        rows: 24,
      },
      persistedSnapshot: '',
      takePtySnapshot: vi.fn(async () => ({ data: 'LIVE_REPAIRED_SCREEN' })),
      isDisposed: () => false,
      onHydratedWriteCommitted: vi.fn(),
      finalizeHydration,
    })

    expect(terminal.reset).toHaveBeenCalledTimes(1)
    expect(finalizeHydration).toHaveBeenCalledWith('LIVE_REPAIRED_SCREEN', {
      scrollStateToRestore: expect.objectContaining({
        baseY: 180,
        viewportY: 150,
        isUserScrolling: true,
        offsetFromBottom: 30,
        wasAtBottom: false,
      }),
    })
  })
})
