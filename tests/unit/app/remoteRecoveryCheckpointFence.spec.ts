import { describe, expect, it, vi } from 'vitest'
import { createRemoteRecoveryCheckpointFence } from '../../../src/app/main/controlSurface/ptyStream/remoteRecoveryCheckpointFence'
import { PtyStreamHub } from '../../../src/app/main/controlSurface/ptyStream/ptyStreamHub'

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve = (_value: T) => undefined
  const promise = new Promise<T>(resolvePromise => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('Remote recovery checkpoint fence', () => {
  it('does not capture a reset presentation before its downstream cursor is published', async () => {
    const fence = createRemoteRecoveryCheckpointFence()
    let cursor = 5
    let screen = 'OLD_SCREEN'
    const settle = fence.beginPresentationTransition('home-session')
    screen = 'AUTHORITATIVE_SCREEN'
    const captureSnapshot = vi.fn(async () => screen)

    const capture = fence.capture({
      sessionId: 'home-session',
      readCursor: () => cursor,
      captureSnapshot,
    })
    await Promise.resolve()

    expect(captureSnapshot).not.toHaveBeenCalled()
    cursor = 10
    settle()

    await expect(capture).resolves.toEqual({
      snapshot: 'AUTHORITATIVE_SCREEN',
      downstreamReplayCursor: 10,
    })
  })

  it('pins the entry cursor without starving while downstream output keeps advancing', async () => {
    const fence = createRemoteRecoveryCheckpointFence()
    const firstSnapshot = deferred<string>()
    let cursor = 5
    const captureSnapshot = vi.fn(async () => await firstSnapshot.promise)

    const capture = fence.capture({
      sessionId: 'home-session',
      readCursor: () => cursor,
      captureSnapshot,
    })
    await vi.waitFor(() => expect(captureSnapshot).toHaveBeenCalledTimes(1))
    for (let nextCursor = 6; nextCursor <= 1_005; nextCursor += 1) {
      cursor = nextCursor
    }
    firstSnapshot.resolve('SCREEN_THROUGH_5')

    await expect(capture).resolves.toEqual({
      snapshot: 'SCREEN_THROUGH_5',
      downstreamReplayCursor: 5,
    })
    expect(captureSnapshot).toHaveBeenCalledTimes(1)
  })

  it('pairs the entry cursor with the Home Hub operation boundary under live output', async () => {
    const fence = createRemoteRecoveryCheckpointFence()
    const hub = new PtyStreamHub({ ptyRuntime: {} as never, replayWindowMaxBytes: 64_000 })
    hub.registerSessionMetadata({
      sessionId: 'home-session',
      kind: 'terminal',
      startedAt: '2026-07-10T00:00:00.000Z',
      cwd: '/tmp',
      command: 'shell',
      args: [],
      cols: 80,
      rows: 24,
    })
    let cursor = 1
    hub.handlePtyData('home-session', 'BEFORE_BOUNDARY\r\n')

    const capture = fence.capture({
      sessionId: 'home-session',
      readCursor: () => cursor,
      captureSnapshot: async () =>
        (await hub.recoveryPresentationSnapshotSession('home-session')).serializedScreen,
    })
    cursor = 2
    hub.handlePtyData('home-session', 'AFTER_BOUNDARY\r\n')

    await expect(capture).resolves.toMatchObject({ downstreamReplayCursor: 1 })
    const captured = await capture
    expect(captured.snapshot).toContain('BEFORE_BOUNDARY')
    expect(captured.snapshot).not.toContain('AFTER_BOUNDARY')
    hub.forgetSession('home-session')
  })

  it('fails closed after a reset was applied but its cursor publication was aborted', async () => {
    const fence = createRemoteRecoveryCheckpointFence()
    const settle = fence.beginPresentationTransition('home-session')
    const capture = fence.capture({
      sessionId: 'home-session',
      readCursor: () => 5,
      captureSnapshot: async () => 'RESET_SCREEN_WITHOUT_CURSOR',
    })

    settle(false)
    await expect(capture).rejects.toThrow('checkpoint invalidated')

    const publishRetryBaseline = fence.beginPresentationTransition('home-session')
    const captureSnapshot = vi.fn(async () => 'AUTHORITATIVE_BASELINE')
    const retriedCapture = fence.capture({
      sessionId: 'home-session',
      readCursor: () => 10,
      captureSnapshot,
    })
    await Promise.resolve()
    expect(captureSnapshot).not.toHaveBeenCalled()

    publishRetryBaseline(true)
    await expect(retriedCapture).resolves.toEqual({
      snapshot: 'AUTHORITATIVE_BASELINE',
      downstreamReplayCursor: 10,
    })
  })
})
