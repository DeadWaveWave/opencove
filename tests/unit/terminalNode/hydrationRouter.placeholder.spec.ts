import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTerminalHydrationRouter } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/hydrationRouter'

describe('hydrationRouter placeholder replacement', () => {
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

    expect(terminal.reset).not.toHaveBeenCalled()
    expect(terminal.write).toHaveBeenCalledWith(
      '\u001bc\u001b[2J\u001b[Hready',
      expect.any(Function),
    )
    expect(outputScheduler.handleChunk).not.toHaveBeenCalled()
    expect(scheduleTranscriptSync).toHaveBeenCalled()
  })

  it('does not replace restored placeholder history with echoed terminal replies', () => {
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
    const scheduleTranscriptSync = vi.fn()

    const router = createTerminalHydrationRouter({
      terminal: terminal as never,
      outputScheduler,
      shouldReplaceAgentPlaceholderAfterHydration: () => true,
      shouldDeferHydratedRedrawChunks: () => true,
      scrollbackBuffer,
      committedScrollbackBuffer,
      recordCommittedScreenState: vi.fn(),
      scheduleTranscriptSync,
      ptyWriteQueue: { flush: vi.fn() },
      markScrollbackDirty: vi.fn(),
      logHydrated: vi.fn(),
      syncTerminalSize: vi.fn(),
      onRevealed: vi.fn(),
      isDisposed: () => false,
    })

    router.handleDataChunk('^[[1;1R^[[?1;2c^[[13;3R^[[I')
    router.finalizeHydration('[placeholder history]')

    expect(terminal.reset).not.toHaveBeenCalled()
    expect(outputScheduler.handleChunk).not.toHaveBeenCalled()
    expect(scrollbackBuffer.set).toHaveBeenCalledWith('[placeholder history]')

    router.handleDataChunk('ready')

    expect(terminal.reset).not.toHaveBeenCalled()
    expect(terminal.write).toHaveBeenCalledWith('\u001bcready', expect.any(Function))
    expect(outputScheduler.handleChunk).not.toHaveBeenCalled()
    expect(scheduleTranscriptSync).toHaveBeenCalled()
  })
})
