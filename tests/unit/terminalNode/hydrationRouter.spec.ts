import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTerminalHydrationRouter } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/hydrationRouter'

describe('hydrationRouter', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', ((callback: FrameRequestCallback) => {
      callback(0)
      return 1
    }) as typeof requestAnimationFrame)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps the recovered display visible until a destructive redraw receives visible follow-up output', () => {
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

    const router = createTerminalHydrationRouter({
      terminal: terminal as never,
      outputScheduler,
      shouldReplaceAgentPlaceholderAfterHydration: () => true,
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
    })

    router.handleDataChunk('resume ready')
    router.finalizeHydration('[placeholder history]')

    expect(terminal.reset).not.toHaveBeenCalled()
    expect(terminal.write).toHaveBeenCalledWith('\u001bcresume ready', expect.any(Function))
    expect(outputScheduler.handleChunk).not.toHaveBeenCalled()

    router.handleDataChunk('\u001b[2J\u001b[H')

    expect(terminal.reset).not.toHaveBeenCalled()
    expect(outputScheduler.handleChunk).not.toHaveBeenCalled()

    router.handleDataChunk('[redraw complete]')

    expect(terminal.reset).not.toHaveBeenCalled()
    expect(outputScheduler.handleChunk).toHaveBeenCalledTimes(1)
    expect(outputScheduler.handleChunk).toHaveBeenCalledWith('\u001b[2J\u001b[H[redraw complete]')
  })

  it('keeps control-only redraw chunks deferred until visible output arrives', () => {
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
    const router = createTerminalHydrationRouter({
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
    })

    router.finalizeHydration('[restored history]')
    router.handleDataChunk('\u001b[D')

    expect(outputScheduler.handleChunk).not.toHaveBeenCalled()

    router.handleDataChunk('\u001b[P')

    expect(outputScheduler.handleChunk).not.toHaveBeenCalled()

    router.handleDataChunk('[prompt]')

    expect(outputScheduler.handleChunk).toHaveBeenCalledTimes(1)
    expect(outputScheduler.handleChunk).toHaveBeenCalledWith('\u001b[D\u001b[P[prompt]')
  })

  it('keeps destructive redraw chunks deferred until visible output arrives', () => {
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

    const router = createTerminalHydrationRouter({
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
    })

    router.finalizeHydration('[restored history]')
    router.handleDataChunk('\u001b[2J\u001b[H')

    expect(outputScheduler.handleChunk).not.toHaveBeenCalled()

    router.handleDataChunk('[redraw complete]')

    expect(outputScheduler.handleChunk).toHaveBeenCalledWith('\u001b[2J\u001b[H[redraw complete]')
  })

  it('defers destructive redraw chunks that arrive before hydration finalizes', () => {
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

    const router = createTerminalHydrationRouter({
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
    })

    router.handleDataChunk('\u001b[2J\u001b[H')
    router.finalizeHydration('[authoritative restored history]')

    expect(outputScheduler.handleChunk).not.toHaveBeenCalled()

    router.handleDataChunk('[redraw complete]')

    expect(outputScheduler.handleChunk).toHaveBeenCalledWith('\u001b[2J\u001b[H[redraw complete]')
  })

  it('timeout-flushes a destructive redraw if no visible output arrives', () => {
    vi.useFakeTimers()
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

    try {
      const router = createTerminalHydrationRouter({
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
      })

      router.finalizeHydration('[restored history]')
      router.handleDataChunk('\u001b[2J\u001b[H')
      vi.advanceTimersByTime(2_500)

      expect(outputScheduler.handleChunk).toHaveBeenCalledWith('\u001b[2J\u001b[H')
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps destructive redraw chunks coalesced after visible live output has arrived', () => {
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

    const router = createTerminalHydrationRouter({
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
    })

    router.finalizeHydration('[restored history]')
    router.handleDataChunk('[live prompt]')
    router.handleDataChunk('\u001b[D')

    expect(outputScheduler.handleChunk).toHaveBeenNthCalledWith(1, '[live prompt]')
    expect(outputScheduler.handleChunk).toHaveBeenNthCalledWith(2, '\u001b[D')

    router.handleDataChunk('\u001b[2J\u001b[H')

    expect(outputScheduler.handleChunk).toHaveBeenCalledTimes(2)

    router.handleDataChunk('[redraw complete]')

    expect(outputScheduler.handleChunk).toHaveBeenNthCalledWith(
      3,
      '\u001b[2J\u001b[H[redraw complete]',
    )
  })

  it('does not reset an accepted worker snapshot baseline on the first redraw chunk', () => {
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

    const router = createTerminalHydrationRouter({
      terminal: terminal as never,
      outputScheduler,
      shouldReplaceAgentPlaceholderAfterHydration: () => false,
      shouldDeferHydratedRedrawChunks: () => false,
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
    })

    router.finalizeHydration('[worker accepted baseline]')
    router.handleDataChunk('\u001b[2J\u001b[Hpost-input redraw')

    expect(terminal.reset).not.toHaveBeenCalled()
    expect(outputScheduler.handleChunk).toHaveBeenCalledWith('\u001b[2J\u001b[Hpost-input redraw')
  })

  it('keeps control-only cursor movement deferred while restored history is protected', () => {
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

    const router = createTerminalHydrationRouter({
      terminal: terminal as never,
      outputScheduler,
      shouldReplaceAgentPlaceholderAfterHydration: () => false,
      shouldDeferHydratedRedrawChunks: () => false,
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
    })

    router.finalizeHydration('[authoritative restored history]')
    router.handleDataChunk('\u001b[D')

    expect(outputScheduler.handleChunk).not.toHaveBeenCalled()
    expect(terminal.reset).not.toHaveBeenCalled()
  })
})
