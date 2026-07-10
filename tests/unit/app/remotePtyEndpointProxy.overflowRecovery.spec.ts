import { describe, expect, it, vi } from 'vitest'
import { createRemotePtyOverflowRecoveryCoordinator } from '../../../src/app/main/controlSurface/ptyStream/remotePtyEndpointProxy.overflowRecovery'

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: Error) => void
} {
  let resolve = (_value: T) => undefined
  let reject = (_error: Error) => undefined
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function snapshot(appliedSeq: number) {
  return {
    sessionId: 'remote-session',
    epoch: 1,
    appliedSeq,
    presentationRevision: 1,
    cols: 80,
    rows: 24,
    geometryRevision: 1,
    bufferKind: 'normal' as const,
    cursor: { x: 0, y: 0 },
    title: null,
    serializedScreen: `screen-${appliedSeq}`,
  }
}

describe('Remote PTY overflow recovery coordinator', () => {
  it('publishes cursor only after reset, then drains data and exit exactly once', async () => {
    const attachedSessions = new Map([
      ['remote-session', { lastSeq: 5, role: 'controller' as const, authorityEpoch: 1 }],
    ])
    const fetched = deferred<ReturnType<typeof snapshot>>()
    const resetApplied = deferred<void>()
    const emitData = vi.fn()
    const emitExit = vi.fn()
    const onPresentationResetSettled = vi.fn()
    const coordinator = createRemotePtyOverflowRecoveryCoordinator({
      attachedSessions,
      fetchPresentationSnapshot: async () => await fetched.promise,
      applyPresentationReset: async () => await resetApplied.promise,
      onPresentationResetSettled,
      emitData,
      emitExit,
      reconnectFromLastAppliedCursor: vi.fn(),
    })

    coordinator.begin('remote-session')
    coordinator.handleData('remote-session', 'covered-by-snapshot', 9)
    coordinator.handleData('remote-session', 'after-snapshot', 11)
    coordinator.handleExit('remote-session', 0, 11)
    coordinator.handleExit('remote-session', 0, 11)
    expect(attachedSessions.get('remote-session')?.lastSeq).toBe(5)

    fetched.resolve(snapshot(10))
    await vi.waitFor(() => expect(resetApplied.resolve).toBeTypeOf('function'))
    expect(attachedSessions.get('remote-session')?.lastSeq).toBe(5)
    expect(onPresentationResetSettled).not.toHaveBeenCalled()
    resetApplied.resolve()

    await vi.waitFor(() =>
      expect(onPresentationResetSettled).toHaveBeenCalledWith('remote-session', true),
    )
    expect(attachedSessions.get('remote-session')?.lastSeq).toBe(11)
    expect(emitData).toHaveBeenCalledTimes(1)
    expect(emitData).toHaveBeenCalledWith('remote-session', 'after-snapshot')
    expect(emitExit).toHaveBeenCalledTimes(1)
    expect(emitExit).toHaveBeenCalledWith('remote-session', 0)
  })

  it('discards buffered events and reconnects from the unchanged cursor after reset failure', async () => {
    const attachedSessions = new Map([
      ['remote-session', { lastSeq: 5, role: 'controller' as const, authorityEpoch: 1 }],
    ])
    const fetched = deferred<ReturnType<typeof snapshot>>()
    const emitData = vi.fn()
    const reconnect = vi.fn()
    const coordinator = createRemotePtyOverflowRecoveryCoordinator({
      attachedSessions,
      fetchPresentationSnapshot: async () => await fetched.promise,
      applyPresentationReset: vi.fn(),
      onPresentationResetSettled: vi.fn(),
      emitData,
      emitExit: vi.fn(),
      reconnectFromLastAppliedCursor: reconnect,
    })

    coordinator.begin('remote-session')
    coordinator.handleData('remote-session', 'must-replay-after-reconnect', 6)
    fetched.reject(new Error('snapshot unavailable'))

    await vi.waitFor(() => expect(reconnect).toHaveBeenCalledTimes(1))
    expect(attachedSessions.get('remote-session')?.lastSeq).toBe(5)
    expect(emitData).not.toHaveBeenCalled()
  })

  it('ignores a late snapshot after forget or dispose', async () => {
    const attachedSessions = new Map([
      ['remote-session', { lastSeq: 5, role: 'controller' as const, authorityEpoch: 1 }],
    ])
    const fetched = deferred<ReturnType<typeof snapshot>>()
    const applyPresentationReset = vi.fn()
    const coordinator = createRemotePtyOverflowRecoveryCoordinator({
      attachedSessions,
      fetchPresentationSnapshot: async () => await fetched.promise,
      applyPresentationReset,
      onPresentationResetSettled: vi.fn(),
      emitData: vi.fn(),
      emitExit: vi.fn(),
      reconnectFromLastAppliedCursor: vi.fn(),
    })

    coordinator.begin('remote-session')
    coordinator.forget('remote-session')
    attachedSessions.delete('remote-session')
    fetched.resolve(snapshot(10))
    await Promise.resolve()
    await Promise.resolve()
    expect(applyPresentationReset).not.toHaveBeenCalled()

    coordinator.dispose()
    attachedSessions.set('remote-session', {
      lastSeq: 5,
      role: 'controller',
      authorityEpoch: 1,
    })
    coordinator.begin('remote-session')
    expect(applyPresentationReset).not.toHaveBeenCalled()
  })

  it('settles without committing when forget wins after reset application starts', async () => {
    const attachedSessions = new Map([
      ['remote-session', { lastSeq: 5, role: 'controller' as const, authorityEpoch: 1 }],
    ])
    const resetApplied = deferred<void>()
    const onPresentationResetSettled = vi.fn()
    const applyPresentationReset = vi.fn(async () => await resetApplied.promise)
    const coordinator = createRemotePtyOverflowRecoveryCoordinator({
      attachedSessions,
      fetchPresentationSnapshot: vi.fn(async () => snapshot(10)),
      applyPresentationReset,
      onPresentationResetSettled,
      emitData: vi.fn(),
      emitExit: vi.fn(),
      reconnectFromLastAppliedCursor: vi.fn(),
    })

    coordinator.begin('remote-session')
    await vi.waitFor(() => expect(applyPresentationReset).toHaveBeenCalledTimes(1))
    coordinator.forget('remote-session')
    attachedSessions.delete('remote-session')
    resetApplied.resolve()

    await vi.waitFor(() =>
      expect(onPresentationResetSettled).toHaveBeenCalledWith('remote-session', false),
    )
  })

  it('drains a recovery that is still fetching its authoritative snapshot at cutoff', async () => {
    const attachedSessions = new Map([
      ['remote-session', { lastSeq: 5, role: 'controller' as const, authorityEpoch: 1 }],
    ])
    const fetched = deferred<ReturnType<typeof snapshot>>()
    const applyPresentationReset = vi.fn(async () => undefined)
    const coordinator = createRemotePtyOverflowRecoveryCoordinator({
      attachedSessions,
      fetchPresentationSnapshot: async () => await fetched.promise,
      applyPresentationReset,
      onPresentationResetSettled: vi.fn(),
      emitData: vi.fn(),
      emitExit: vi.fn(),
      reconnectFromLastAppliedCursor: vi.fn(),
    })

    coordinator.begin('remote-session')
    let drained = false
    const cutoff = coordinator.drainAndStopAccepting().then(() => {
      drained = true
    })
    await Promise.resolve()
    expect(drained).toBe(false)

    fetched.resolve(snapshot(10))
    await cutoff
    expect(applyPresentationReset).toHaveBeenCalledTimes(1)
    expect(attachedSessions.get('remote-session')?.lastSeq).toBe(10)

    coordinator.begin('remote-session')
    expect(applyPresentationReset).toHaveBeenCalledTimes(1)
  })

  it('does not advance the public cursor for messages delivered after cutoff', async () => {
    const attachedSessions = new Map([
      ['remote-session', { lastSeq: 5, role: 'controller' as const, authorityEpoch: 1 }],
    ])
    const emitData = vi.fn()
    const emitExit = vi.fn()
    const coordinator = createRemotePtyOverflowRecoveryCoordinator({
      attachedSessions,
      fetchPresentationSnapshot: vi.fn(async () => snapshot(10)),
      applyPresentationReset: vi.fn(async () => undefined),
      onPresentationResetSettled: vi.fn(),
      emitData,
      emitExit,
      reconnectFromLastAppliedCursor: vi.fn(),
    })

    await coordinator.drainAndStopAccepting()
    coordinator.handleData('remote-session', 'late-data', 6)
    coordinator.handleExit('remote-session', 0, 6)

    expect(attachedSessions.get('remote-session')?.lastSeq).toBe(5)
    expect(emitData).not.toHaveBeenCalled()
    expect(emitExit).not.toHaveBeenCalled()
  })
})
