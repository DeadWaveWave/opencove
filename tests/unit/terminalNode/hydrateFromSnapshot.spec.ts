import { describe, expect, it, vi } from 'vitest'
import { hydrateTerminalFromSnapshot } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/hydrateFromSnapshot'

describe('hydrateFromSnapshot', () => {
  it('prefers the presentation snapshot baseline when available', async () => {
    const terminal = {
      cols: 80,
      rows: 24,
      resize: vi.fn((cols: number, rows: number) => {
        terminal.cols = cols
        terminal.rows = rows
      }),
      write: vi.fn((data: string, callback?: () => void) => {
        callback?.()
        return data
      }),
    }
    const onHydratedWriteCommitted = vi.fn()
    const finalizeHydration = vi.fn()
    const onHydrationBaselineResolved = vi.fn()
    const onPresentationSnapshotAccepted = vi.fn()
    const takePtySnapshot = vi.fn(async () => ({ data: 'live fallback output' }))

    await hydrateTerminalFromSnapshot({
      attachPromise: Promise.resolve(),
      sessionId: 'agent-session-presentation',
      terminal: terminal as never,
      kind: 'agent',
      cachedScreenState: null,
      persistedSnapshot: 'persisted placeholder',
      presentationSnapshotPromise: Promise.resolve({
        sessionId: 'agent-session-presentation',
        epoch: 1,
        appliedSeq: 4,
        presentationRevision: 9,
        cols: 96,
        rows: 30,
        bufferKind: 'alternate',
        cursor: { x: 5, y: 10 },
        title: 'codex',
        serializedScreen: '\u001b[?1049hLIVE_SCREEN',
      }),
      takePtySnapshot,
      isDisposed: () => false,
      onHydratedWriteCommitted,
      onHydrationBaselineResolved,
      onPresentationSnapshotAccepted,
      finalizeHydration,
    })

    expect(terminal.resize).toHaveBeenCalledWith(96, 30)
    expect(terminal.write).toHaveBeenCalledWith('\u001b[?1049hLIVE_SCREEN', expect.any(Function))
    expect(onPresentationSnapshotAccepted).toHaveBeenCalled()
    expect(onHydrationBaselineResolved).toHaveBeenCalledWith('presentation_snapshot')
    expect(onHydratedWriteCommitted).toHaveBeenCalledWith('\u001b[?1049hLIVE_SCREEN')
    expect(finalizeHydration).toHaveBeenCalledWith('\u001b[?1049hLIVE_SCREEN')
    expect(takePtySnapshot).not.toHaveBeenCalled()
  })

  it('does not treat cached raw snapshot as correctness truth once worker presentation exists', async () => {
    const terminal = {
      cols: 80,
      rows: 24,
      resize: vi.fn((cols: number, rows: number) => {
        terminal.cols = cols
        terminal.rows = rows
      }),
      write: vi.fn((data: string, callback?: () => void) => {
        callback?.()
        return data
      }),
    }
    const onHydratedWriteCommitted = vi.fn()
    const finalizeHydration = vi.fn()
    const onHydrationBaselineResolved = vi.fn()

    await hydrateTerminalFromSnapshot({
      attachPromise: Promise.resolve(),
      sessionId: 'agent-session-presentation',
      terminal: terminal as never,
      kind: 'agent',
      cachedScreenState: {
        sessionId: 'agent-session-presentation',
        serialized: 'cached serialized screen',
        cols: 90,
        rows: 28,
      },
      persistedSnapshot: 'persisted placeholder',
      presentationSnapshotPromise: Promise.resolve({
        sessionId: 'agent-session-presentation',
        epoch: 2,
        appliedSeq: 8,
        presentationRevision: 12,
        cols: 96,
        rows: 30,
        bufferKind: 'normal',
        cursor: { x: 2, y: 3 },
        title: 'codex',
        serializedScreen: 'worker serialized screen',
      }),
      takePtySnapshot: vi.fn(async () => ({ data: 'live fallback output' })),
      isDisposed: () => false,
      onHydratedWriteCommitted,
      onHydrationBaselineResolved,
      finalizeHydration,
    })

    expect(onHydrationBaselineResolved).toHaveBeenCalledWith('presentation_snapshot')
    expect(onHydratedWriteCommitted).toHaveBeenCalledWith('worker serialized screen')
    expect(finalizeHydration).toHaveBeenCalledWith('worker serialized screen')
    expect(terminal.write).toHaveBeenCalledWith('worker serialized screen', expect.any(Function))
    expect(terminal.write).not.toHaveBeenCalledWith(
      'cached serialized screen',
      expect.any(Function),
    )
  })

  it('uses cached screen only as a visual placeholder before replacing with live snapshot fallback', async () => {
    const terminal = {
      cols: 80,
      rows: 24,
      resize: vi.fn(),
      reset: vi.fn(),
      write: vi.fn((data: string, callback?: () => void) => {
        callback?.()
        return data
      }),
    }
    const onHydratedWriteCommitted = vi.fn()
    const finalizeHydration = vi.fn()
    const onHydrationBaselineResolved = vi.fn()

    await hydrateTerminalFromSnapshot({
      attachPromise: Promise.resolve(),
      sessionId: 'terminal-session-cached',
      terminal: terminal as never,
      kind: 'terminal',
      cachedScreenState: {
        sessionId: 'terminal-session-cached',
        serialized: 'cached serialized screen',
        cols: 90,
        rows: 28,
      },
      persistedSnapshot: '',
      takePtySnapshot: vi.fn(async () => ({ data: 'live fallback output' })),
      isDisposed: () => false,
      onHydratedWriteCommitted,
      onHydrationBaselineResolved,
      finalizeHydration,
    })

    expect(terminal.write).toHaveBeenNthCalledWith(
      1,
      'cached serialized screen',
      expect.any(Function),
    )
    expect(terminal.reset).toHaveBeenCalledTimes(1)
    expect(terminal.write).toHaveBeenNthCalledWith(2, 'live fallback output', expect.any(Function))
    expect(onHydrationBaselineResolved).toHaveBeenCalledWith('live_pty_snapshot')
    expect(onHydratedWriteCommitted).toHaveBeenLastCalledWith('live fallback output')
    expect(finalizeHydration).toHaveBeenCalledWith('live fallback output')
  })

  it('uses the live PTY snapshot for agent live reattach hydration', async () => {
    const terminal = {
      cols: 80,
      rows: 24,
      resize: vi.fn(),
      write: vi.fn((data: string, callback?: () => void) => {
        callback?.()
        return data
      }),
    }
    const onHydratedWriteCommitted = vi.fn()
    const finalizeHydration = vi.fn()
    const onHydrationBaselineResolved = vi.fn()
    const takePtySnapshot = vi.fn(async () => ({ data: 'live agent output' }))

    await hydrateTerminalFromSnapshot({
      attachPromise: Promise.resolve(),
      sessionId: 'agent-session-1',
      terminal: terminal as never,
      kind: 'agent',
      useLivePtySnapshotDuringHydration: true,
      cachedScreenState: null,
      persistedSnapshot: '',
      takePtySnapshot,
      isDisposed: () => false,
      onHydratedWriteCommitted,
      onHydrationBaselineResolved,
      finalizeHydration,
    })

    expect(takePtySnapshot).toHaveBeenCalledWith({ sessionId: 'agent-session-1' })
    expect(terminal.write).toHaveBeenCalledWith('live agent output', expect.any(Function))
    expect(onHydrationBaselineResolved).toHaveBeenCalledWith('live_pty_snapshot')
    expect(onHydratedWriteCommitted).toHaveBeenCalledWith('live agent output')
    expect(finalizeHydration).toHaveBeenCalledWith('live agent output')
  })

  it('keeps a non-empty persisted agent baseline when the live PTY delta is control-only', async () => {
    const terminal = {
      cols: 80,
      rows: 24,
      resize: vi.fn(),
      write: vi.fn((data: string, callback?: () => void) => {
        callback?.()
        return data
      }),
    }
    const onHydratedWriteCommitted = vi.fn()
    const finalizeHydration = vi.fn()
    const onHydrationBaselineResolved = vi.fn()

    await hydrateTerminalFromSnapshot({
      attachPromise: Promise.resolve(),
      sessionId: 'agent-session-control-only-live',
      terminal: terminal as never,
      kind: 'agent',
      useLivePtySnapshotDuringHydration: true,
      cachedScreenState: null,
      persistedSnapshot: '[opencove-test-click] ready',
      takePtySnapshot: vi.fn(async () => ({
        data: '[opencove-test-click] ready\u001b[2J\u001b[H      ',
      })),
      isDisposed: () => false,
      onHydratedWriteCommitted,
      onHydrationBaselineResolved,
      finalizeHydration,
    })

    expect(terminal.write).toHaveBeenCalledWith('[opencove-test-click] ready', expect.any(Function))
    expect(terminal.write).not.toHaveBeenCalledWith('\u001b[2J\u001b[H      ', expect.any(Function))
    expect(onHydrationBaselineResolved).toHaveBeenCalledWith('live_pty_snapshot')
    expect(finalizeHydration).toHaveBeenCalledWith('[opencove-test-click] ready')
  })

  it('keeps a non-empty persisted agent baseline when the presentation snapshot is blank-only', async () => {
    const terminal = {
      cols: 80,
      rows: 24,
      resize: vi.fn(),
      write: vi.fn((data: string, callback?: () => void) => {
        callback?.()
        return data
      }),
    }
    const onHydratedWriteCommitted = vi.fn()
    const finalizeHydration = vi.fn()
    const onHydrationBaselineResolved = vi.fn()
    const onPresentationSnapshotAccepted = vi.fn()
    const takePtySnapshot = vi.fn(async () => ({ data: 'live fallback output' }))

    await hydrateTerminalFromSnapshot({
      attachPromise: Promise.resolve(),
      sessionId: 'agent-session-blank-presentation',
      terminal: terminal as never,
      kind: 'agent',
      cachedScreenState: null,
      persistedSnapshot: 'persisted restored history',
      presentationSnapshotPromise: Promise.resolve({
        sessionId: 'agent-session-blank-presentation',
        epoch: 1,
        appliedSeq: 2,
        presentationRevision: 3,
        cols: 96,
        rows: 30,
        bufferKind: 'normal',
        cursor: { x: 0, y: 0 },
        title: 'codex',
        serializedScreen: '\u001b[2J\u001b[H   \n',
      }),
      takePtySnapshot,
      isDisposed: () => false,
      onHydratedWriteCommitted,
      onHydrationBaselineResolved,
      onPresentationSnapshotAccepted,
      finalizeHydration,
    })

    expect(terminal.resize).not.toHaveBeenCalled()
    expect(terminal.write).toHaveBeenCalledWith('persisted restored history', expect.any(Function))
    expect(onPresentationSnapshotAccepted).not.toHaveBeenCalled()
    expect(onHydrationBaselineResolved).toHaveBeenCalledWith('placeholder_snapshot')
    expect(onHydratedWriteCommitted).toHaveBeenLastCalledWith('persisted restored history')
    expect(finalizeHydration).toHaveBeenCalledWith('persisted restored history')
    expect(takePtySnapshot).not.toHaveBeenCalled()
  })
})
