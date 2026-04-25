import { describe, expect, it, vi } from 'vitest'
import { createTerminalHydrationRouter } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/hydrationRouter'

function createProtectedRedrawRouter() {
  const terminal = {
    reset: vi.fn(),
    write: vi.fn(),
  }
  const outputScheduler = {
    handleChunk: vi.fn(),
  }
  const scrollbackBuffer = {
    set: vi.fn(),
    append: vi.fn(),
  }
  const committedScrollbackBuffer = {
    set: vi.fn(),
    append: vi.fn(),
    snapshot: vi.fn(() => ''),
  }

  return {
    outputScheduler,
    router: createTerminalHydrationRouter({
      terminal: terminal as never,
      outputScheduler,
      shouldReplaceAgentPlaceholderAfterHydration: () => false,
      shouldDeferHydratedRedrawChunks: () => true,
      hasRecentUserInteraction: () => true,
      scrollbackBuffer,
      committedScrollbackBuffer,
      recordCommittedScreenState: vi.fn(),
      scheduleTranscriptSync: vi.fn(),
      ptyWriteQueue: { flush: vi.fn() },
      markScrollbackDirty: vi.fn(),
      logHydrated: vi.fn(),
      syncTerminalSize: vi.fn(),
      onRevealed: vi.fn(),
      isDisposed: () => false,
    }),
  }
}

describe('hydrationRouter redraw protection', () => {
  it('does not treat printable mouse echo before a clear as redraw replacement content', () => {
    const { outputScheduler, router } = createProtectedRedrawRouter()

    router.finalizeHydration('[restored history]')
    router.handleDataChunk('^[[<0;34;22M\u001b[2J\u001b[H')

    expect(outputScheduler.handleChunk).not.toHaveBeenCalled()

    router.handleDataChunk('[redraw complete]')

    expect(outputScheduler.handleChunk).toHaveBeenCalledWith(
      '^[[<0;34;22M\u001b[2J\u001b[H[redraw complete]',
    )
  })

  it('keeps split destructive redraw chunks deferred after user interaction', () => {
    const { outputScheduler, router } = createProtectedRedrawRouter()

    router.finalizeHydration('[restored history]')
    router.handleDataChunk('\u001b[2')
    router.handleDataChunk('J\u001b[H')

    expect(outputScheduler.handleChunk).not.toHaveBeenCalled()

    router.handleDataChunk('[redraw complete]')

    expect(outputScheduler.handleChunk).toHaveBeenCalledWith('\u001b[2J\u001b[H[redraw complete]')
  })
})
