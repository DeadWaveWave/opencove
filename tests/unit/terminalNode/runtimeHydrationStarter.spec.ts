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
})
