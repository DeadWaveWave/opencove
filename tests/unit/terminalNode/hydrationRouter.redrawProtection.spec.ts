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
  it('notifies after buffered hydration output is committed to xterm', () => {
    const onReplayWriteCommitted = vi.fn()
    const terminal = {
      reset: vi.fn(),
      write: vi.fn((_data: string, callback?: () => void) => {
        callback?.()
      }),
    }
    const router = createTerminalHydrationRouter({
      terminal: terminal as never,
      outputScheduler: { handleChunk: vi.fn() },
      shouldReplaceAgentPlaceholderAfterHydration: () => false,
      shouldDeferHydratedRedrawChunks: () => false,
      scrollbackBuffer: { set: vi.fn(), append: vi.fn() },
      committedScrollbackBuffer: {
        set: vi.fn(),
        append: vi.fn(),
        snapshot: vi.fn(() => '[visible replay]'),
      },
      recordCommittedScreenState: vi.fn(),
      scheduleTranscriptSync: vi.fn(),
      ptyWriteQueue: { flush: vi.fn() },
      markScrollbackDirty: vi.fn(),
      logHydrated: vi.fn(),
      syncTerminalSize: vi.fn(),
      onReplayWriteCommitted,
      onRevealed: vi.fn(),
      isDisposed: () => false,
    })

    router.handleDataChunk('[visible replay]')
    router.finalizeHydration('')

    expect(onReplayWriteCommitted).toHaveBeenCalledTimes(1)
  })

  it('protects restored visible output that arrives after empty hydration', () => {
    const terminal = {
      reset: vi.fn(),
      write: vi.fn(),
    }
    const outputScheduler = {
      handleChunk: vi.fn(),
    }
    const router = createTerminalHydrationRouter({
      terminal: terminal as never,
      outputScheduler,
      shouldReplaceAgentPlaceholderAfterHydration: () => false,
      shouldDeferHydratedRedrawChunks: () => false,
      scrollbackBuffer: { set: vi.fn(), append: vi.fn() },
      committedScrollbackBuffer: {
        set: vi.fn(),
        append: vi.fn(),
        snapshot: vi.fn(() => ''),
      },
      recordCommittedScreenState: vi.fn(),
      scheduleTranscriptSync: vi.fn(),
      ptyWriteQueue: { flush: vi.fn() },
      markScrollbackDirty: vi.fn(),
      logHydrated: vi.fn(),
      syncTerminalSize: vi.fn(),
      onRevealed: vi.fn(),
      isDisposed: () => false,
    })

    router.finalizeHydration('')
    router.handleDataChunk('[restored live frame]')
    router.protectHydratedVisibleBaseline()
    router.handleDataChunk('\u001b[2J\u001b[H')

    expect(outputScheduler.handleChunk).toHaveBeenCalledTimes(1)
    expect(outputScheduler.handleChunk).toHaveBeenCalledWith('[restored live frame]')

    router.handleDataChunk('[redraw complete]')

    expect(outputScheduler.handleChunk).toHaveBeenNthCalledWith(
      2,
      '\u001b[2J\u001b[H[redraw complete]',
    )
  })

  it('protects buffered restored output replayed during hydration', () => {
    const terminal = {
      reset: vi.fn(),
      write: vi.fn((_data: string, callback?: () => void) => {
        callback?.()
      }),
    }
    const outputScheduler = {
      handleChunk: vi.fn(),
    }
    const router = createTerminalHydrationRouter({
      terminal: terminal as never,
      outputScheduler,
      shouldReplaceAgentPlaceholderAfterHydration: () => false,
      shouldDeferHydratedRedrawChunks: () => false,
      scrollbackBuffer: { set: vi.fn(), append: vi.fn() },
      committedScrollbackBuffer: {
        set: vi.fn(),
        append: vi.fn(),
        snapshot: vi.fn(() => '[restored replay]'),
      },
      recordCommittedScreenState: vi.fn(),
      scheduleTranscriptSync: vi.fn(),
      ptyWriteQueue: { flush: vi.fn() },
      markScrollbackDirty: vi.fn(),
      logHydrated: vi.fn(),
      syncTerminalSize: vi.fn(),
      onRevealed: vi.fn(),
      isDisposed: () => false,
    })

    router.handleDataChunk('[restored replay]')
    router.finalizeHydration('')
    router.handleDataChunk('\u001b[2J\u001b[H')

    expect(outputScheduler.handleChunk).not.toHaveBeenCalled()

    router.handleDataChunk('[redraw complete]')

    expect(outputScheduler.handleChunk).toHaveBeenCalledWith('\u001b[2J\u001b[H[redraw complete]')
  })

  it('strips printable mouse echo before replaying a protected redraw', () => {
    const { outputScheduler, router } = createProtectedRedrawRouter()

    router.finalizeHydration('[restored history]')
    router.handleDataChunk('^[[<0;34;22M\u001b[2J\u001b[H')

    expect(outputScheduler.handleChunk).not.toHaveBeenCalled()

    router.handleDataChunk('[redraw complete]')

    expect(outputScheduler.handleChunk).toHaveBeenCalledWith('\u001b[2J\u001b[H[redraw complete]')
  })

  it('keeps split destructive redraw chunks deferred until visible output arrives', () => {
    const { outputScheduler, router } = createProtectedRedrawRouter()

    router.finalizeHydration('[restored history]')
    router.handleDataChunk('\u001b[2')
    router.handleDataChunk('J\u001b[H')

    expect(outputScheduler.handleChunk).not.toHaveBeenCalled()

    router.handleDataChunk('[redraw complete]')

    expect(outputScheduler.handleChunk).toHaveBeenCalledWith('\u001b[2J\u001b[H[redraw complete]')
  })
})
