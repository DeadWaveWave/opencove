import { describe, expect, it, vi } from 'vitest'
import { createTerminalHydrationRouter } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/hydrationRouter'

function createRouterHarness() {
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

  return { router, terminal, outputScheduler, scrollbackBuffer }
}

describe('hydrationRouter sequence replay', () => {
  it('drops hydration chunks already covered by the accepted presentation snapshot seq', () => {
    const { router, terminal, scrollbackBuffer } = createRouterHarness()

    router.handleDataChunk('covered by snapshot', { seq: 4 })
    router.handleDataChunk('fresh output', { seq: 6 })
    router.finalizeHydration('[accepted worker snapshot]', { baselineAppliedSeq: 5 })

    expect(terminal.write).toHaveBeenCalledTimes(1)
    expect(terminal.write).toHaveBeenCalledWith('fresh output', expect.any(Function))
    expect(scrollbackBuffer.append).toHaveBeenCalledWith('fresh output')
  })

  it('answers pure snapshot-covered automatic terminal queries during hydration', () => {
    const { router, terminal, outputScheduler } = createRouterHarness()

    router.handleDataChunk('\u001b[c', { seq: 4 })

    expect(outputScheduler.handleChunk).toHaveBeenCalledWith('\u001b[c')

    router.finalizeHydration('[accepted worker snapshot]', { baselineAppliedSeq: 5 })

    expect(terminal.write).not.toHaveBeenCalledWith('\u001b[c', expect.any(Function))
  })

  it('extracts automatic terminal queries from mixed chunks covered by the accepted snapshot', () => {
    const { router, terminal, scrollbackBuffer } = createRouterHarness()

    router.handleDataChunk('covered output\u001b[c\u001b[?u', { seq: 4 })
    router.finalizeHydration('[accepted worker snapshot]', { baselineAppliedSeq: 5 })

    expect(terminal.write).toHaveBeenCalledWith('\u001b[c\u001b[?u', expect.any(Function))
    expect(scrollbackBuffer.append).toHaveBeenCalledWith('\u001b[c\u001b[?u')
    expect(scrollbackBuffer.append).not.toHaveBeenCalledWith('covered output')
  })

  it('drops non-query hydration chunks without seq after an authoritative snapshot baseline', () => {
    const { router, terminal, scrollbackBuffer } = createRouterHarness()

    router.handleDataChunk('duplicate replay without seq')
    router.handleDataChunk('duplicate plus query\u001b[c')
    router.finalizeHydration('[accepted worker snapshot]', { baselineAppliedSeq: 5 })

    expect(terminal.write).toHaveBeenCalledTimes(1)
    expect(terminal.write).toHaveBeenCalledWith('\u001b[c', expect.any(Function))
    expect(scrollbackBuffer.append).toHaveBeenCalledWith('\u001b[c')
    expect(scrollbackBuffer.append).not.toHaveBeenCalledWith('duplicate replay without seq')
    expect(scrollbackBuffer.append).not.toHaveBeenCalledWith('duplicate plus query')
  })

  it('replaces an accepted baseline when a fresh destructive TUI frame arrives during hydration', () => {
    const { terminal, scrollbackBuffer } = createRouterHarness()

    const replacingRouter = createTerminalHydrationRouter({
      terminal: terminal as never,
      outputScheduler: { handleChunk: vi.fn() },
      shouldReplaceAgentPlaceholderAfterHydration: () => false,
      shouldReplaceAuthoritativeBaselineWithBufferedOutput: () => true,
      shouldDeferHydratedRedrawChunks: () => false,
      scrollbackBuffer,
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

    replacingRouter.handleDataChunk('\u001b[2J\u001b[Hfresh frame', { seq: 6 })
    replacingRouter.finalizeHydration('[stale accepted snapshot]', { baselineAppliedSeq: 5 })

    expect(terminal.write).toHaveBeenCalledWith(
      '\u001bc\u001b[2J\u001b[Hfresh frame',
      expect.any(Function),
    )
    expect(scrollbackBuffer.set).toHaveBeenCalledWith('')
    expect(scrollbackBuffer.append).toHaveBeenCalledWith('\u001b[2J\u001b[Hfresh frame')
  })
})
