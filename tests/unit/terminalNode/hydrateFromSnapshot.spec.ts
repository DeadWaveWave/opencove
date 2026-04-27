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
    expect(finalizeHydration).toHaveBeenCalledWith('\u001b[?1049hLIVE_SCREEN', {
      baselineAppliedSeq: 4,
    })
    expect(takePtySnapshot).not.toHaveBeenCalled()
  })

  it('waits for attach before finalizing a presentation snapshot baseline', async () => {
    let resolveAttach!: () => void
    let resolveWrite!: () => void
    const attachPromise = new Promise<void>(resolve => {
      resolveAttach = resolve
    })
    const writeObserved = new Promise<void>(resolve => {
      resolveWrite = resolve
    })
    const terminal = {
      cols: 80,
      rows: 24,
      resize: vi.fn((cols: number, rows: number) => {
        terminal.cols = cols
        terminal.rows = rows
      }),
      write: vi.fn((data: string, callback?: () => void) => {
        callback?.()
        resolveWrite()
        return data
      }),
    }
    const finalizeHydration = vi.fn()

    const hydrationPromise = hydrateTerminalFromSnapshot({
      attachPromise,
      sessionId: 'terminal-session-presentation',
      terminal: terminal as never,
      kind: 'terminal',
      cachedScreenState: null,
      persistedSnapshot: '',
      presentationSnapshotPromise: Promise.resolve({
        sessionId: 'terminal-session-presentation',
        epoch: 1,
        appliedSeq: 12,
        presentationRevision: 2,
        cols: 100,
        rows: 32,
        bufferKind: 'normal',
        cursor: { x: 1, y: 1 },
        title: 'terminal',
        serializedScreen: 'READY_PROMPT',
      }),
      takePtySnapshot: vi.fn(async () => ({ data: 'live fallback output' })),
      isDisposed: () => false,
      onHydratedWriteCommitted: vi.fn(),
      finalizeHydration,
    })

    await writeObserved
    expect(terminal.write).toHaveBeenCalledWith('READY_PROMPT', expect.any(Function))
    expect(finalizeHydration).not.toHaveBeenCalled()

    resolveAttach()
    await hydrationPromise

    expect(finalizeHydration).toHaveBeenCalledWith('READY_PROMPT', { baselineAppliedSeq: 12 })
  })

  it('finalizes a visible presentation snapshot after a bounded attach wait', async () => {
    vi.useFakeTimers()
    let resolveWrite!: () => void
    const writeObserved = new Promise<void>(resolve => {
      resolveWrite = resolve
    })
    const terminal = {
      cols: 80,
      rows: 24,
      resize: vi.fn((cols: number, rows: number) => {
        terminal.cols = cols
        terminal.rows = rows
      }),
      write: vi.fn((data: string, callback?: () => void) => {
        callback?.()
        resolveWrite()
        return data
      }),
    }
    const finalizeHydration = vi.fn()

    try {
      const hydrationPromise = hydrateTerminalFromSnapshot({
        attachPromise: new Promise(() => undefined),
        sessionId: 'terminal-session-presentation-timeout',
        terminal: terminal as never,
        kind: 'terminal',
        cachedScreenState: null,
        persistedSnapshot: '',
        presentationSnapshotPromise: Promise.resolve({
          sessionId: 'terminal-session-presentation-timeout',
          epoch: 1,
          appliedSeq: 12,
          presentationRevision: 2,
          cols: 100,
          rows: 32,
          bufferKind: 'normal',
          cursor: { x: 1, y: 1 },
          title: 'terminal',
          serializedScreen: 'READY_PROMPT',
        }),
        takePtySnapshot: vi.fn(async () => ({ data: 'live fallback output' })),
        isDisposed: () => false,
        onHydratedWriteCommitted: vi.fn(),
        finalizeHydration,
      })

      await writeObserved
      expect(finalizeHydration).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(1_600)
      await hydrationPromise

      expect(finalizeHydration).toHaveBeenCalledWith('READY_PROMPT', { baselineAppliedSeq: 12 })
    } finally {
      vi.useRealTimers()
    }
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
    expect(finalizeHydration).toHaveBeenCalledWith('worker serialized screen', {
      baselineAppliedSeq: 8,
    })
    expect(terminal.write).toHaveBeenCalledWith('worker serialized screen', expect.any(Function))
    expect(terminal.write).not.toHaveBeenCalledWith(
      'cached serialized screen',
      expect.any(Function),
    )
  })

  it('does not reveal a control-only agent presentation snapshot as visible history', async () => {
    const terminal = {
      cols: 80,
      rows: 24,
      resize: vi.fn(),
      write: vi.fn((data: string, callback?: () => void) => {
        callback?.()
        return data
      }),
    }
    const onHydrationBaselineResolved = vi.fn()
    const finalizeHydration = vi.fn()

    await hydrateTerminalFromSnapshot({
      attachPromise: Promise.resolve(),
      sessionId: 'agent-session-control-only',
      terminal: terminal as never,
      kind: 'agent',
      cachedScreenState: null,
      persistedSnapshot: '',
      presentationSnapshotPromise: Promise.resolve({
        sessionId: 'agent-session-control-only',
        epoch: 1,
        appliedSeq: 2,
        presentationRevision: 3,
        cols: 96,
        rows: 30,
        bufferKind: 'normal',
        cursor: { x: 0, y: 0 },
        title: 'codex',
        serializedScreen: '\u001b[?2004h',
      }),
      takePtySnapshot: vi.fn(async () => ({ data: 'live fallback output' })),
      isDisposed: () => false,
      onHydratedWriteCommitted: vi.fn(),
      onHydrationBaselineResolved,
      finalizeHydration,
    })

    expect(terminal.write).not.toHaveBeenCalled()
    expect(onHydrationBaselineResolved).toHaveBeenCalledWith('empty')
    expect(finalizeHydration).toHaveBeenCalledWith('')
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

  it('does not use persisted agent scrollback as a live reattach baseline', async () => {
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

    expect(terminal.write).toHaveBeenCalledWith(
      '[opencove-test-click] ready\u001b[2J\u001b[H      ',
      expect.any(Function),
    )
    expect(onHydrationBaselineResolved).toHaveBeenCalledWith('live_pty_snapshot')
    expect(finalizeHydration).toHaveBeenCalledWith(
      '[opencove-test-click] ready\u001b[2J\u001b[H      ',
    )
  })

  it('does not reveal blank-only agent presentation snapshots as restored history', async () => {
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

    expect(terminal.resize).toHaveBeenCalledWith(96, 30)
    expect(terminal.write).not.toHaveBeenCalledWith(
      'persisted restored history',
      expect.any(Function),
    )
    expect(terminal.write).not.toHaveBeenCalled()
    expect(onPresentationSnapshotAccepted).not.toHaveBeenCalled()
    expect(onHydrationBaselineResolved).toHaveBeenCalledWith('empty')
    expect(onHydratedWriteCommitted).toHaveBeenLastCalledWith('')
    expect(finalizeHydration).toHaveBeenCalledWith('')
    expect(takePtySnapshot).not.toHaveBeenCalled()
  })
})
