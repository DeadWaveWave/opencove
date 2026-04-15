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

  it('keeps the placeholder visible until buffered output becomes visibly replaceable', () => {
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
    const recordCommittedScreenState = vi.fn()
    const scheduleTranscriptSync = vi.fn()

    const router = createTerminalHydrationRouter({
      terminal: terminal as never,
      outputScheduler,
      shouldReplaceAgentPlaceholderAfterHydration: () => true,
      shouldDeferHydratedRedrawChunks: () => true,
      hasRecentUserInteraction: () => false,
      scrollbackBuffer,
      committedScrollbackBuffer,
      recordCommittedScreenState,
      scheduleTranscriptSync,
      ptyWriteQueue: { flush: vi.fn() },
      markScrollbackDirty: vi.fn(),
      logHydrated: vi.fn(),
      syncTerminalSize: vi.fn(),
      onRevealed: vi.fn(),
      isDisposed: () => false,
    })

    router.handleDataChunk('\u001b[2J\u001b[H')
    router.finalizeHydration('[placeholder history]')

    expect(terminal.reset).not.toHaveBeenCalled()
    expect(outputScheduler.handleChunk).not.toHaveBeenCalled()
    expect(scrollbackBuffer.set).toHaveBeenCalledWith('[placeholder history]')

    router.handleDataChunk('ready')

    expect(terminal.reset).toHaveBeenCalledTimes(1)
    expect(outputScheduler.handleChunk).toHaveBeenCalledTimes(1)
    expect(outputScheduler.handleChunk).toHaveBeenCalledWith('\u001b[2J\u001b[Hready')
    expect(scheduleTranscriptSync).toHaveBeenCalled()
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
      hasRecentUserInteraction: () => false,
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

    expect(terminal.reset).toHaveBeenCalledTimes(1)
    expect(outputScheduler.handleChunk).not.toHaveBeenCalled()

    router.handleDataChunk('\u001b[2J\u001b[H')

    expect(terminal.reset).toHaveBeenCalledTimes(1)
    expect(outputScheduler.handleChunk).not.toHaveBeenCalled()

    router.handleDataChunk('[redraw complete]')

    expect(terminal.reset).toHaveBeenCalledTimes(1)
    expect(outputScheduler.handleChunk).toHaveBeenCalledTimes(1)
    expect(outputScheduler.handleChunk).toHaveBeenCalledWith('\u001b[2J\u001b[H[redraw complete]')
  })

  it('flushes deferred redraw control chunks immediately after real user interaction', () => {
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
    let hasRecentUserInteraction = false

    const router = createTerminalHydrationRouter({
      terminal: terminal as never,
      outputScheduler,
      shouldReplaceAgentPlaceholderAfterHydration: () => false,
      shouldDeferHydratedRedrawChunks: () => true,
      hasRecentUserInteraction: () => hasRecentUserInteraction,
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

    hasRecentUserInteraction = true
    router.handleDataChunk('\u001b[P')

    expect(outputScheduler.handleChunk).toHaveBeenCalledTimes(1)
    expect(outputScheduler.handleChunk).toHaveBeenCalledWith('\u001b[D\u001b[P')
  })
})
