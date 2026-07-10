import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TerminalRecoveryOwner } from '../../../src/contexts/terminal/application/recovery/TerminalRecoveryOwner'
import type { ControlSurfacePtyRuntime } from '../../../src/app/main/controlSurface/handlers/sessionPtyRuntime'
import type { PresentationSnapshotTerminalResult } from '../../../src/shared/contracts/dto'
import { WebSessionManager } from '../../../src/app/main/controlSurface/http/webSessionManager'
import { createPtyStreamService } from '../../../src/app/main/controlSurface/ptyStream/ptyStreamService'

function createOpenWebSocketMock() {
  const sent: unknown[] = []
  const ws = {
    OPEN: 1,
    readyState: 1,
    bufferedAmount: 0,
    send: vi.fn((raw: string) => sent.push(JSON.parse(raw))),
    close: vi.fn(),
  }
  return { ws: ws as never, sent }
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = () => undefined
  const promise = new Promise<void>(resolvePromise => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('PtyStreamService recovery barrier', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('keeps observing runtime output while client ingress is frozen, until the explicit cutoff', async () => {
    const dataListeners = new Set<(event: { sessionId: string; data: string }) => void>()
    const runtime: ControlSurfacePtyRuntime = {
      spawnSession: vi.fn(async () => ({ sessionId: 'session-1' })),
      write: vi.fn(),
      resize: vi.fn(async input => ({
        sessionId: input.sessionId,
        operationId: input.operationId ?? 'resize-1',
        status: 'accepted',
        changed: true,
        geometry: { cols: input.cols, rows: input.rows, revision: 1 },
        authority: null,
      })),
      kill: vi.fn(),
      onData: listener => {
        dataListeners.add(listener)
        return () => dataListeners.delete(listener)
      },
      onExit: vi.fn(() => () => undefined),
    }
    const service = createPtyStreamService({
      token: 'token',
      webSessions: new WebSessionManager(),
      now: () => new Date('2026-07-10T00:00:00.000Z'),
      ptyRuntime: runtime,
      replayWindowMaxBytes: 64_000,
    })
    const noteOutput = vi.fn()
    const completeFlush = {
      status: 'complete' as const,
      committed: 1,
      failures: [],
    }
    let resolveFirstFlush: ((value: typeof completeFlush) => void) | null = null
    const flushAll = vi
      .fn()
      .mockImplementationOnce(
        async () =>
          await new Promise<typeof completeFlush>(resolve => {
            resolveFirstFlush = resolve
          }),
      )
      .mockResolvedValue(completeFlush)
    service.setRecoveryOwner({ noteOutput, flushAll } as unknown as TerminalRecoveryOwner)

    service.freezeIngress()
    const firstDrain = service.flushRecovery()
    dataListeners.forEach(listener => listener({ sessionId: 'session-1', data: 'during-drain' }))
    resolveFirstFlush?.(completeFlush)
    await firstDrain

    expect(noteOutput).toHaveBeenCalledWith({
      sessionId: 'session-1',
      data: 'during-drain',
    })
    expect(dataListeners.size).toBe(1)

    await service.quiesce()
    dataListeners.forEach(listener => listener({ sessionId: 'session-1', data: 'after-cutoff' }))
    await service.flushRecovery()

    expect(noteOutput).toHaveBeenCalledTimes(1)
    expect(dataListeners.size).toBe(0)
    expect(flushAll).toHaveBeenCalledTimes(2)
    service.dispose()
  })

  it('records a degraded owner retirement when a runtime session exits', async () => {
    let emitExit: ((event: { sessionId: string; exitCode: number }) => void) | null = null
    const runtime: ControlSurfacePtyRuntime = {
      spawnSession: vi.fn(async () => ({ sessionId: 'session-1' })),
      write: vi.fn(),
      resize: vi.fn(async input => ({
        sessionId: input.sessionId,
        operationId: input.operationId ?? 'resize-1',
        status: 'accepted',
        changed: true,
        geometry: { cols: input.cols, rows: input.rows, revision: 1 },
        authority: null,
      })),
      kill: vi.fn(),
      onData: vi.fn(() => () => undefined),
      onExit: listener => {
        emitExit = listener
        return () => {
          emitExit = null
        }
      },
    }
    const service = createPtyStreamService({
      token: 'token',
      webSessions: new WebSessionManager(),
      now: () => new Date('2026-07-10T00:00:00.000Z'),
      ptyRuntime: runtime,
      replayWindowMaxBytes: 64_000,
    })
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const retireSession = vi.fn(async () => ({
      status: 'degraded' as const,
      committed: 0,
      failures: [
        {
          nodeId: 'node-1',
          sessionId: 'session-1',
          reason: 'commit_failed' as const,
        },
      ],
    }))
    const flushSession = vi.fn()
    const forgetSession = vi.fn()
    service.setRecoveryOwner({
      retireSession,
      flushSession,
      forgetSession,
    } as unknown as TerminalRecoveryOwner)

    emitExit?.({ sessionId: 'session-1', exitCode: 0 })
    await vi.waitFor(() => expect(retireSession).toHaveBeenCalledWith('session-1'))
    await vi.waitFor(() =>
      expect(stderrWrite).toHaveBeenCalledWith(
        expect.stringContaining('terminal recovery exit retire degraded for session-1'),
      ),
    )

    expect(flushSession).not.toHaveBeenCalled()
    expect(forgetSession).not.toHaveBeenCalled()
    service.dispose()
  })

  it('waits for an accepted presentation reset and its committed cursor before cutoff', async () => {
    let emitPresentationReset:
      | ((event: {
          sessionId: string
          snapshot: PresentationSnapshotTerminalResult
        }) => void | Promise<void>)
      | null = null
    let emitPresentationResetCommitted:
      | ((event: { sessionId: string; committed: boolean }) => void)
      | null = null
    const runtime: ControlSurfacePtyRuntime = {
      spawnSession: vi.fn(async () => ({ sessionId: 'session-reset' })),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      onData: vi.fn(() => () => undefined),
      onExit: vi.fn(() => () => undefined),
      onPresentationReset: listener => {
        emitPresentationReset = listener
        return () => {
          emitPresentationReset = null
        }
      },
      onPresentationResetCommitted: listener => {
        emitPresentationResetCommitted = listener
        return () => {
          emitPresentationResetCommitted = null
        }
      },
    }
    const service = createPtyStreamService({
      token: 'token',
      webSessions: new WebSessionManager(),
      now: () => new Date('2026-07-10T00:00:00.000Z'),
      ptyRuntime: runtime,
      replayWindowMaxBytes: 64_000,
    })
    const resetBarrier = deferred()
    vi.spyOn(service.hub, 'replaceSessionPresentationCurrent').mockImplementation(
      async () => await resetBarrier.promise,
    )
    const notePresentationMutation = vi.fn()
    service.setRecoveryOwner({ notePresentationMutation } as unknown as TerminalRecoveryOwner)

    const reset = Promise.resolve(
      emitPresentationReset?.({
        sessionId: 'session-reset',
        snapshot: {
          sessionId: 'session-reset',
          epoch: 1,
          appliedSeq: 9,
          presentationRevision: 1,
          cols: 80,
          rows: 24,
          geometryRevision: 1,
          bufferKind: 'normal',
          cursor: { x: 0, y: 0 },
          title: null,
          serializedScreen: 'RESET_SCREEN',
        },
      }),
    )
    let cutoffResolved = false
    const cutoff = service.quiesce().then(() => {
      cutoffResolved = true
    })
    await Promise.resolve()
    expect(cutoffResolved).toBe(false)

    resetBarrier.resolve()
    await reset
    expect(cutoffResolved).toBe(false)
    emitPresentationResetCommitted?.({ sessionId: 'session-reset', committed: true })
    await cutoff

    expect(notePresentationMutation).toHaveBeenCalledWith({ sessionId: 'session-reset' })
    service.dispose()
  })

  it('marks recovery dirty only after an accepted changed geometry commit', async () => {
    const runtime: ControlSurfacePtyRuntime = {
      spawnSession: vi.fn(async () => ({ sessionId: 'session-geometry' })),
      write: vi.fn(),
      resize: vi.fn(async input => ({
        sessionId: input.sessionId,
        operationId: input.operationId ?? 'resize-geometry',
        status: 'accepted',
        changed: true,
        geometry: { cols: input.cols, rows: input.rows, revision: null },
        authority: null,
      })),
      kill: vi.fn(),
      onData: vi.fn(() => () => undefined),
      onExit: vi.fn(() => () => undefined),
    }
    const service = createPtyStreamService({
      token: 'token',
      webSessions: new WebSessionManager(),
      now: () => new Date('2026-07-10T00:00:00.000Z'),
      ptyRuntime: runtime,
      replayWindowMaxBytes: 64_000,
    })
    const notePresentationMutation = vi.fn()
    service.setRecoveryOwner({ notePresentationMutation } as unknown as TerminalRecoveryOwner)
    const controller = createOpenWebSocketMock()
    const viewer = createOpenWebSocketMock()
    service.hub.registerClient({ clientId: 'controller', kind: 'desktop', ws: controller.ws })
    service.hub.registerClient({ clientId: 'viewer', kind: 'web', ws: viewer.ws })
    service.hub.registerSessionMetadata({
      sessionId: 'session-geometry',
      kind: 'terminal',
      startedAt: '2026-07-10T00:00:00.000Z',
      cwd: '/tmp',
      command: 'zsh',
      args: [],
      cols: 80,
      rows: 24,
    })
    service.hub.attach({ clientId: 'controller', sessionId: 'session-geometry' })
    service.hub.attach({ clientId: 'viewer', sessionId: 'session-geometry' })

    const changed = await service.hub.resize({
      clientId: 'controller',
      sessionId: 'session-geometry',
      cols: 100,
      rows: 30,
      operationId: 'resize-changed',
      baseGeometryRevision: null,
      authorityEpoch: 1,
    })
    expect(changed).toMatchObject({ status: 'accepted', changed: true })
    expect(notePresentationMutation).toHaveBeenCalledWith({ sessionId: 'session-geometry' })

    notePresentationMutation.mockClear()
    const unchanged = await service.hub.resize({
      clientId: 'controller',
      sessionId: 'session-geometry',
      cols: 100,
      rows: 30,
      operationId: 'resize-unchanged',
      baseGeometryRevision: 1,
      authorityEpoch: 1,
    })
    expect(unchanged).toMatchObject({ status: 'accepted', changed: false })

    const rejected = await service.hub.resize({
      clientId: 'viewer',
      sessionId: 'session-geometry',
      cols: 120,
      rows: 36,
      operationId: 'resize-rejected',
      baseGeometryRevision: 1,
      authorityEpoch: 1,
    })
    expect(rejected.status).toBe('rejected_not_controller')
    expect(notePresentationMutation).not.toHaveBeenCalled()
    service.dispose()
  })
})
