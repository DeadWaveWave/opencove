import { describe, expect, it, vi } from 'vitest'
import { startRuntimeTerminalHydration } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/runtimeHydrationStarter'

describe('runtimeHydrationStarter', () => {
  it('preserves the worker presentation snapshot sequence baseline when finalizing hydration', async () => {
    const terminal = {
      cols: 80,
      rows: 24,
      resize: vi.fn((cols: number, rows: number) => {
        terminal.cols = cols
        terminal.rows = rows
      }),
      write: vi.fn((_data: string, callback?: () => void) => {
        callback?.()
      }),
    }
    const hydrationRouter = {
      handleDataChunk: vi.fn(),
      handleExit: vi.fn(),
      protectHydratedVisibleBaseline: vi.fn(),
      finalizeHydration: vi.fn(),
    }

    startRuntimeTerminalHydration({
      attachPromise: Promise.resolve(),
      sessionId: 'agent-session',
      terminal: terminal as never,
      kind: 'agent',
      isLiveSessionReattach: false,
      shouldSkipInitialPlaceholderWrite: true,
      cachedScreenState: null,
      scrollbackBuffer: { snapshot: () => '' },
      committedScrollbackBuffer: { set: vi.fn() },
      committedScreenStateRecorder: { record: vi.fn() },
      scheduleTranscriptSync: vi.fn(),
      presentationSnapshotPromise: Promise.resolve({
        sessionId: 'agent-session',
        epoch: 1,
        appliedSeq: 12,
        presentationRevision: 2,
        cols: 96,
        rows: 30,
        bufferKind: 'alternate',
        cursor: { x: 1, y: 1 },
        title: null,
        serializedScreen: 'RESTORED_AGENT_SCREEN',
      }),
      hydrationBaselineSourceRef: { current: 'empty' },
      lastCommittedPtySizeRef: { current: null },
      runtimeInputBridge: {
        enableTerminalDataForwarding: vi.fn(),
        releaseBufferedUserInput: vi.fn(),
      } as never,
      hydrationRouter,
      scrollStateToRestore: null,
      shouldGateInitialUserInput: false,
      shouldAwaitAgentVisibleOutput: false,
      isDisposed: () => false,
    })

    await vi.waitFor(() => {
      expect(hydrationRouter.finalizeHydration).toHaveBeenCalled()
    })

    expect(hydrationRouter.finalizeHydration).toHaveBeenCalledWith('RESTORED_AGENT_SCREEN', {
      baselineAppliedSeq: 12,
    })
  })

  it('restores a preserved viewport after hydration finalizes', async () => {
    const terminal = {
      cols: 80,
      rows: 24,
      buffer: {
        active: {
          baseY: 220,
          viewportY: 220,
        },
      },
      _core: {
        _bufferService: {
          isUserScrolling: false,
          buffer: {
            ydisp: 220,
          },
        },
        _viewport: {
          queueSync: vi.fn((ydisp?: number) => {
            if (typeof ydisp === 'number') {
              terminal.buffer.active.viewportY = ydisp
            }
          }),
          scrollToLine: vi.fn((line: number) => {
            terminal.buffer.active.viewportY = line
          }),
        },
      },
      scrollToLine: vi.fn((line: number) => {
        terminal.buffer.active.viewportY = line
      }),
      resize: vi.fn(),
      write: vi.fn((data: string, callback?: () => void) => {
        if (data === 'RESTORED_TERMINAL_SCREEN') {
          terminal.buffer.active.baseY = 220
          terminal.buffer.active.viewportY = 220
          terminal._core._bufferService.buffer.ydisp = 220
        }
        callback?.()
      }),
    }
    const hydrationRouter = {
      handleDataChunk: vi.fn(),
      handleExit: vi.fn(),
      protectHydratedVisibleBaseline: vi.fn(),
      finalizeHydration: vi.fn(),
    }
    const onScrollStateRestored = vi.fn()

    startRuntimeTerminalHydration({
      attachPromise: Promise.resolve(),
      sessionId: 'terminal-session',
      terminal: terminal as never,
      kind: 'terminal',
      isLiveSessionReattach: false,
      shouldSkipInitialPlaceholderWrite: true,
      cachedScreenState: null,
      scrollbackBuffer: { snapshot: () => '' },
      committedScrollbackBuffer: { set: vi.fn() },
      committedScreenStateRecorder: { record: vi.fn() },
      scheduleTranscriptSync: vi.fn(),
      presentationSnapshotPromise: Promise.resolve({
        sessionId: 'terminal-session',
        epoch: 1,
        appliedSeq: 8,
        presentationRevision: 3,
        cols: 96,
        rows: 30,
        bufferKind: 'normal',
        cursor: { x: 1, y: 1 },
        title: null,
        serializedScreen: 'RESTORED_TERMINAL_SCREEN',
      }),
      hydrationBaselineSourceRef: { current: 'empty' },
      lastCommittedPtySizeRef: { current: null },
      runtimeInputBridge: {
        enableTerminalDataForwarding: vi.fn(),
        releaseBufferedUserInput: vi.fn(),
      } as never,
      hydrationRouter,
      scrollStateToRestore: {
        baseY: 180,
        viewportY: 150,
        isUserScrolling: true,
        offsetFromBottom: 30,
        wasAtBottom: false,
      },
      onScrollStateRestored,
      shouldGateInitialUserInput: false,
      shouldAwaitAgentVisibleOutput: false,
      isDisposed: () => false,
    })

    await vi.waitFor(() => {
      expect(hydrationRouter.finalizeHydration).toHaveBeenCalled()
    })

    expect(terminal.scrollToLine).toHaveBeenCalledWith(190)
    expect(terminal.buffer.active.viewportY).toBe(190)
    expect(terminal._core._bufferService.isUserScrolling).toBe(true)
    expect(onScrollStateRestored).toHaveBeenCalledTimes(1)
  })
})
