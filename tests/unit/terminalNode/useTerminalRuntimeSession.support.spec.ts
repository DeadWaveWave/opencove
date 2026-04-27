import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  attachAfterPresentationSnapshot,
  isAuthoritativeHydrationBaselineSource,
  requestPresentationSnapshotAfterGeometry,
  shouldProtectHydratedAgentHistory,
  shouldReusePreservedXtermSession,
  shouldTreatHydratedAgentBaselineAsPlaceholder,
} from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/useTerminalRuntimeSession.support'

function createPresentationSnapshot(cols: number, rows: number) {
  return {
    sessionId: 'session-1',
    epoch: 1,
    appliedSeq: 42,
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
})
