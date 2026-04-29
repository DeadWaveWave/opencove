import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  attachAfterPresentationSnapshot,
  createRestoredAgentVisibleOutputObserver,
  isAuthoritativeHydrationBaselineSource,
  prepareRuntimePresentationAttach,
  requestPresentationSnapshotAfterGeometry,
  shouldAwaitRestoredAgentVisibleOutput,
  shouldGateRestoredAgentInput,
  shouldProtectHydratedAgentHistory,
  shouldRequirePostGeometrySnapshotOutput,
  shouldReusePreservedXtermSession,
  shouldTreatHydratedAgentBaselineAsPlaceholder,
} from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/useTerminalRuntimeSession.support'

function createPresentationSnapshot(cols: number, rows: number, appliedSeq = 42) {
  return {
    sessionId: 'session-1',
    epoch: 1,
    appliedSeq,
    presentationRevision: 3,
    cols,
    rows,
    bufferKind: 'normal' as const,
    cursor: { x: 0, y: 0 },
    title: null,
    serializedScreen: 'ready',
  }
}

describe('useTerminalRuntimeSession support', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('treats worker presentation and live PTY baselines as authoritative', () => {
    expect(isAuthoritativeHydrationBaselineSource('presentation_snapshot')).toBe(true)
    expect(isAuthoritativeHydrationBaselineSource('live_pty_snapshot')).toBe(true)
    expect(isAuthoritativeHydrationBaselineSource('placeholder_snapshot')).toBe(false)
    expect(isAuthoritativeHydrationBaselineSource('empty')).toBe(false)
  })

  it('keeps authoritative live reattach baselines out of placeholder replacement mode', () => {
    expect(
      shouldTreatHydratedAgentBaselineAsPlaceholder({
        kind: 'agent',
        agentResumeSessionIdVerified: true,
        agentLaunchMode: 'resume',
        persistedSnapshot: '[restored history]',
        baselineSource: 'live_pty_snapshot',
      }),
    ).toBe(false)

    expect(
      shouldTreatHydratedAgentBaselineAsPlaceholder({
        kind: 'agent',
        agentResumeSessionIdVerified: true,
        agentLaunchMode: 'resume',
        persistedSnapshot: '[restored history]',
        baselineSource: 'placeholder_snapshot',
      }),
    ).toBe(true)

    expect(
      shouldTreatHydratedAgentBaselineAsPlaceholder({
        kind: 'agent',
        agentResumeSessionIdVerified: true,
        agentLaunchMode: 'resume',
        persistedSnapshot: '[restored history]',
        baselineSource: 'empty',
      }),
    ).toBe(false)
  })

  it('gates restored agent input until live output catches up', () => {
    expect(
      shouldGateRestoredAgentInput({
        kind: 'agent',
        persistedSnapshot: '',
        agentResumeSessionIdVerified: true,
        agentLaunchMode: 'resume',
      }),
    ).toBe(true)

    expect(
      shouldAwaitRestoredAgentVisibleOutput({
        kind: 'agent',
        agentResumeSessionIdVerified: true,
        agentLaunchMode: 'resume',
      }),
    ).toBe(true)

    expect(
      shouldGateRestoredAgentInput({
        kind: 'agent',
        persistedSnapshot: '',
        agentResumeSessionIdVerified: true,
        agentLaunchMode: 'resume',
      }),
    ).toBe(true)

    expect(
      shouldGateRestoredAgentInput({
        kind: 'agent',
        persistedSnapshot: '',
        agentResumeSessionIdVerified: false,
        agentLaunchMode: 'new',
      }),
    ).toBe(true)

    expect(
      shouldAwaitRestoredAgentVisibleOutput({
        kind: 'agent',
        agentResumeSessionIdVerified: false,
        agentLaunchMode: 'new',
      }),
    ).toBe(true)

    expect(
      shouldAwaitRestoredAgentVisibleOutput({
        kind: 'terminal',
        agentResumeSessionIdVerified: true,
        agentLaunchMode: 'resume',
      }),
    ).toBe(false)
  })

  it('requires post-geometry output for every cold agent snapshot', () => {
    expect(
      shouldRequirePostGeometrySnapshotOutput({
        kind: 'agent',
        isLiveSessionReattach: false,
        agentResumeSessionIdVerified: true,
        agentLaunchMode: 'resume',
      }),
    ).toBe(true)

    expect(
      shouldRequirePostGeometrySnapshotOutput({
        kind: 'agent',
        isLiveSessionReattach: false,
        agentResumeSessionIdVerified: false,
        agentLaunchMode: 'resume',
      }),
    ).toBe(true)

    expect(
      shouldRequirePostGeometrySnapshotOutput({
        kind: 'agent',
        isLiveSessionReattach: true,
        agentResumeSessionIdVerified: true,
        agentLaunchMode: 'resume',
      }),
    ).toBe(false)

    expect(
      shouldRequirePostGeometrySnapshotOutput({
        kind: 'agent',
        isLiveSessionReattach: false,
        agentResumeSessionIdVerified: false,
        agentLaunchMode: 'new',
      }),
    ).toBe(true)

    expect(
      shouldRequirePostGeometrySnapshotOutput({
        kind: 'terminal',
        isLiveSessionReattach: false,
        agentResumeSessionIdVerified: true,
        agentLaunchMode: 'resume',
      }),
    ).toBe(false)
  })

  it('only defers post-hydration redraw protection for non-authoritative baselines', () => {
    expect(
      shouldProtectHydratedAgentHistory({
        kind: 'agent',
        agentResumeSessionIdVerified: true,
        agentLaunchMode: 'resume',
        persistedSnapshot: '[restored history]',
      }),
    ).toBe(true)
  })

  it('reuses only DOM preserved sessions during placeholder handoff', () => {
    expect(
      shouldReusePreservedXtermSession({
        preservedSession: {
          renderer: { kind: 'dom' },
        } as never,
        terminalClientResetVersion: 0,
      }),
    ).toBe(true)

    expect(
      shouldReusePreservedXtermSession({
        preservedSession: {
          renderer: { kind: 'webgl' },
        } as never,
        terminalClientResetVersion: 0,
      }),
    ).toBe(false)

    expect(
      shouldReusePreservedXtermSession({
        preservedSession: {
          renderer: { kind: 'dom' },
        } as never,
        terminalClientResetVersion: 1,
      }),
    ).toBe(false)
  })

  it('releases restored agent readiness after meaningful output is committed', () => {
    const onReady = vi.fn()
    const cancelCheck = vi.fn()
    const observer = createRestoredAgentVisibleOutputObserver({
      hasVisibleOutput: () => false,
      onReady,
      scheduleCheck: () => 1,
      cancelCheck,
    })

    observer.beginWaiting()
    observer.notifyWriteCommitted('\u001b[HRestored Codex prompt')

    expect(onReady).toHaveBeenCalledTimes(1)
    expect(cancelCheck).toHaveBeenCalledWith(1)
  })

  it('polls for visible restored agent output after PTY data is observed', () => {
    const scheduledChecks: Array<() => void> = []
    let hasVisibleOutput = false
    const onReady = vi.fn()
    const observer = createRestoredAgentVisibleOutputObserver({
      hasVisibleOutput: () => hasVisibleOutput,
      onReady,
      scheduleCheck: callback => {
        scheduledChecks.push(callback)
        return scheduledChecks.length
      },
      cancelCheck: () => undefined,
      maxChecks: 3,
    })

    observer.beginWaiting()
    observer.notifyOutputObserved('\u001b[HRestored Codex prompt')
    scheduledChecks.shift()?.()
    expect(onReady).not.toHaveBeenCalled()

    hasVisibleOutput = true
    scheduledChecks.shift()?.()

    expect(onReady).toHaveBeenCalledTimes(1)
  })

  it('fails open after meaningful restored output when renderer visibility does not report ready', () => {
    const scheduledChecks: Array<() => void> = []
    const onReady = vi.fn()
    const observer = createRestoredAgentVisibleOutputObserver({
      hasVisibleOutput: () => false,
      onReady,
      scheduleCheck: callback => {
        scheduledChecks.push(callback)
        return scheduledChecks.length
      },
      cancelCheck: () => undefined,
      maxChecks: 5,
      meaningfulOutputGraceChecks: 1,
    })

    observer.beginWaiting()
    observer.notifyOutputObserved('\u001b[?2026h\u001b[HRestored Codex prompt')
    scheduledChecks.shift()?.()
    expect(onReady).not.toHaveBeenCalled()

    scheduledChecks.shift()?.()

    expect(onReady).toHaveBeenCalledTimes(1)
  })

  it('fails open when restored agent visibility never becomes observable', () => {
    const scheduledChecks: Array<() => void> = []
    const onReady = vi.fn()
    const observer = createRestoredAgentVisibleOutputObserver({
      hasVisibleOutput: () => false,
      onReady,
      scheduleCheck: callback => {
        scheduledChecks.push(callback)
        return scheduledChecks.length
      },
      cancelCheck: () => undefined,
      maxChecks: 2,
    })

    observer.beginWaiting()
    scheduledChecks.shift()?.()
    expect(onReady).not.toHaveBeenCalled()

    scheduledChecks.shift()?.()
    expect(onReady).toHaveBeenCalledTimes(1)
  })

  it('attaches from the worker presentation snapshot sequence baseline', async () => {
    const attached: Array<{ sessionId: string; afterSeq?: number | null }> = []

    await attachAfterPresentationSnapshot({
      ptyApi: {
        attach: async payload => {
          attached.push(payload)
        },
      } as never,
      sessionId: 'session-1',
      presentationSnapshotPromise: Promise.resolve({
        sessionId: 'session-1',
        epoch: 1,
        appliedSeq: 42,
        presentationRevision: 3,
        cols: 120,
        rows: 40,
        bufferKind: 'normal',
        cursor: { x: 0, y: 0 },
        title: null,
        serializedScreen: 'ready',
      }),
    })

    expect(attached).toStrictEqual([{ sessionId: 'session-1', afterSeq: 42 }])
  })

  it('waits until the worker presentation snapshot reaches committed initial geometry', async () => {
    const staleSnapshot = createPresentationSnapshot(80, 24)
    const committedSnapshot = createPresentationSnapshot(132, 41)
    const requestSnapshot = vi
      .fn()
      .mockResolvedValueOnce(staleSnapshot)
      .mockResolvedValueOnce(committedSnapshot)
    const wait = vi.fn(async () => undefined)

    const snapshot = await requestPresentationSnapshotAfterGeometry({
      sessionId: 'session-1',
      expectedGeometry: { cols: 132, rows: 41 },
      requestSnapshot,
      wait,
    })

    expect(snapshot).toBe(committedSnapshot)
    expect(requestSnapshot).toHaveBeenCalledTimes(2)
    expect(wait).toHaveBeenCalledTimes(1)
  })

  it('does not poll presentation snapshots when no geometry or output fence is required', async () => {
    const requestSnapshot = vi.fn(async () => null)
    const wait = vi.fn(async () => undefined)

    const snapshot = await requestPresentationSnapshotAfterGeometry({
      sessionId: 'session-1',
      expectedGeometry: null,
      requestSnapshot,
      wait,
    })

    expect(snapshot).toBeNull()
    expect(requestSnapshot).toHaveBeenCalledTimes(1)
    expect(wait).not.toHaveBeenCalled()
  })

  it('waits for post-resize output before accepting an agent cold-restore geometry snapshot', async () => {
    const resizedBeforeTuiRedraw = createPresentationSnapshot(132, 41, 42)
    const resizedAfterControlOnlyOutput = {
      ...createPresentationSnapshot(132, 41, 43),
      serializedScreen: '\u001b[?2004h',
    }
    const resizedAfterTuiRedraw = createPresentationSnapshot(132, 41, 44)
    const requestSnapshot = vi
      .fn()
      .mockResolvedValueOnce(resizedBeforeTuiRedraw)
      .mockResolvedValueOnce(resizedAfterControlOnlyOutput)
      .mockResolvedValueOnce(resizedAfterTuiRedraw)
    const wait = vi.fn(async () => undefined)

    const snapshot = await requestPresentationSnapshotAfterGeometry({
      sessionId: 'session-1',
      expectedGeometry: { cols: 132, rows: 41 },
      minAppliedSeqExclusive: 42,
      requireMeaningfulSerializedScreen: true,
      requestSnapshot,
      wait,
    })

    expect(snapshot).toBe(resizedAfterTuiRedraw)
    expect(requestSnapshot).toHaveBeenCalledTimes(3)
    expect(wait).toHaveBeenCalledTimes(2)
  })

  it('still waits for meaningful restored output when initial geometry cannot be measured', async () => {
    const controlOnlySnapshot = {
      ...createPresentationSnapshot(132, 41, 43),
      serializedScreen: '\u001b[?2004h',
    }
    const visibleSnapshot = createPresentationSnapshot(132, 41, 44)
    const requestSnapshot = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(controlOnlySnapshot)
      .mockResolvedValueOnce(visibleSnapshot)
    const wait = vi.fn(async () => undefined)

    const snapshot = await requestPresentationSnapshotAfterGeometry({
      sessionId: 'session-1',
      expectedGeometry: null,
      minAppliedSeqExclusive: 42,
      requireMeaningfulSerializedScreen: true,
      requestSnapshot,
      wait,
    })

    expect(snapshot).toBe(visibleSnapshot)
    expect(requestSnapshot).toHaveBeenCalledTimes(3)
    expect(wait).toHaveBeenCalledTimes(2)
  })

  it('returns a post-geometry sequence fence when visible restored output never arrives', async () => {
    const controlOnlySnapshot = {
      ...createPresentationSnapshot(132, 41, 43),
      serializedScreen: '\u001b[?2004h',
    }
    const requestSnapshot = vi.fn(async () => controlOnlySnapshot)
    const wait = vi.fn(async () => undefined)

    const snapshot = await requestPresentationSnapshotAfterGeometry({
      sessionId: 'session-1',
      expectedGeometry: { cols: 132, rows: 41 },
      minAppliedSeqExclusive: 42,
      requireMeaningfulSerializedScreen: true,
      requestSnapshot,
      wait,
      maxAttempts: 3,
    })

    expect(snapshot).toBe(controlOnlySnapshot)
    expect(requestSnapshot).toHaveBeenCalledTimes(3)
    expect(wait).toHaveBeenCalledTimes(2)
  })

  it('fails closed instead of accepting a stale post-resize presentation geometry', async () => {
    const requestSnapshot = vi.fn(async () => createPresentationSnapshot(80, 24))

    const snapshot = await requestPresentationSnapshotAfterGeometry({
      sessionId: 'session-1',
      expectedGeometry: { cols: 132, rows: 41 },
      requestSnapshot,
      wait: async () => undefined,
      maxAttempts: 2,
    })

    expect(snapshot).toBeNull()
    expect(requestSnapshot).toHaveBeenCalledTimes(2)
  })

  it('skips the post-geometry output fence when initial geometry is already canonical', async () => {
    const baselineSnapshot = createPresentationSnapshot(64, 44, 42)
    const presentationSnapshot = vi.fn(async () => baselineSnapshot)
    const attach = vi.fn(async () => undefined)
    const commitInitialGeometry = vi.fn(async () => ({ cols: 64, rows: 44, changed: false }))

    vi.stubGlobal('window', {
      opencoveApi: {
        pty: {
          presentationSnapshot,
        },
      },
    })

    const { attachPromise, presentationSnapshotPromise } = prepareRuntimePresentationAttach({
      ptyApi: {
        attach,
      } as never,
      sessionId: 'session-1',
      isLiveSessionReattach: false,
      commitInitialGeometry,
      requirePostGeometrySnapshotOutput: true,
    })

    await attachPromise
    const snapshot = await presentationSnapshotPromise

    expect(snapshot).toBe(baselineSnapshot)
    expect(attach).toHaveBeenCalledWith({ sessionId: 'session-1', afterSeq: 42 })
    expect(commitInitialGeometry).toHaveBeenCalledWith(baselineSnapshot)
    expect(presentationSnapshot).toHaveBeenCalledTimes(2)
  })
})
