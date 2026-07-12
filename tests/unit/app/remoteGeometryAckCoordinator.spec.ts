import { describe, expect, it, vi } from 'vitest'
import { createRemoteGeometryAckCoordinator } from '../../../src/app/main/controlSurface/remote/remoteGeometryAckCoordinator'

describe('remote geometry ACK coordinator', () => {
  it('correlates modern results by operation and session', async () => {
    const coordinator = createRemoteGeometryAckCoordinator()
    const pending = coordinator.waitForResult({
      sessionId: 'session-1',
      operationId: 'operation-1',
      timeoutMs: 1_000,
      timeoutMessage: 'timeout',
    })
    const result = {
      sessionId: 'session-1',
      operationId: 'operation-1',
      status: 'accepted' as const,
      changed: true,
      geometry: { cols: 100, rows: 32, revision: 4 },
      authority: { role: 'controller' as const, epoch: 2 },
    }

    expect(coordinator.resolveResult({ ...result, sessionId: 'other-session' })).toBe(false)
    expect(coordinator.resolveResult(result)).toBe(true)
    await expect(pending).resolves.toEqual(result)
  })

  it('isolates the same operation id across sessions and resolves reverse-order ACKs', async () => {
    const coordinator = createRemoteGeometryAckCoordinator()
    const firstPending = coordinator.waitForResult({
      sessionId: 'session-first',
      operationId: 'shared-operation',
      timeoutMs: 1_000,
      timeoutMessage: 'first timeout',
    })
    const secondPending = coordinator.waitForResult({
      sessionId: 'session-second',
      operationId: 'shared-operation',
      timeoutMs: 1_000,
      timeoutMessage: 'second timeout',
    })
    const firstResult = {
      sessionId: 'session-first',
      operationId: 'shared-operation',
      status: 'accepted' as const,
      changed: true,
      geometry: { cols: 100, rows: 32, revision: 4 },
      authority: { role: 'controller' as const, epoch: 2 },
    }
    const secondResult = {
      sessionId: 'session-second',
      operationId: 'shared-operation',
      status: 'accepted' as const,
      changed: true,
      geometry: { cols: 120, rows: 40, revision: 7 },
      authority: { role: 'controller' as const, epoch: 5 },
    }

    expect(coordinator.resolveResult(secondResult)).toBe(true)
    await expect(secondPending).resolves.toEqual(secondResult)
    expect(coordinator.resolveResult(firstResult)).toBe(true)
    await expect(firstPending).resolves.toEqual(firstResult)
  })

  it('does not let one session timeout delete another session with the same operation id', async () => {
    vi.useFakeTimers()
    try {
      const coordinator = createRemoteGeometryAckCoordinator()
      const timedOutPending = coordinator.waitForResult({
        sessionId: 'session-timeout',
        operationId: 'shared-operation',
        timeoutMs: 25,
        timeoutMessage: 'isolated timeout',
      })
      const survivingPending = coordinator.waitForResult({
        sessionId: 'session-survivor',
        operationId: 'shared-operation',
        timeoutMs: 100,
        timeoutMessage: 'unexpected survivor timeout',
      })
      const timedOutRejection = expect(timedOutPending).rejects.toThrow('isolated timeout')

      await vi.advanceTimersByTimeAsync(25)
      await timedOutRejection

      const survivingResult = {
        sessionId: 'session-survivor',
        operationId: 'shared-operation',
        status: 'accepted' as const,
        changed: true,
        geometry: { cols: 90, rows: 28, revision: 3 },
        authority: { role: 'controller' as const, epoch: 1 },
      }
      expect(coordinator.resolveResult(survivingResult)).toBe(true)
      await expect(survivingPending).resolves.toEqual(survivingResult)
    } finally {
      vi.useRealTimers()
    }
  })

  it('resolves legacy geometry revisions and rejects pending session work', async () => {
    const coordinator = createRemoteGeometryAckCoordinator()
    const legacyPending = coordinator.waitForResult({
      sessionId: 'legacy-session',
      operationId: 'legacy-operation',
      legacyRevision: 7,
      timeoutMs: 1_000,
      timeoutMessage: 'timeout',
    })

    expect(
      coordinator.resolveLegacyGeometry(
        {
          sessionId: 'legacy-session',
          cols: 120,
          rows: 40,
          reason: 'frame_commit',
          revision: 7,
        },
        { role: 'controller', epoch: 3 },
      ),
    ).toBe(true)
    await expect(legacyPending).resolves.toMatchObject({
      operationId: 'legacy-operation',
      status: 'accepted',
      geometry: { cols: 120, rows: 40, revision: 7 },
    })

    const rejected = coordinator.waitForResult({
      sessionId: 'session-error',
      operationId: 'operation-error',
      timeoutMs: 1_000,
      timeoutMessage: 'timeout',
    })
    expect(coordinator.rejectSession('session-error', new Error('not controller'))).toBe(true)
    await expect(rejected).rejects.toThrow('not controller')
  })

  it('cleans up timed out operations', async () => {
    vi.useFakeTimers()
    try {
      const coordinator = createRemoteGeometryAckCoordinator()
      const pending = coordinator.waitForResult({
        sessionId: 'session-timeout',
        operationId: 'operation-timeout',
        timeoutMs: 25,
        timeoutMessage: 'geometry timeout',
      })
      const rejection = expect(pending).rejects.toThrow('geometry timeout')

      await vi.advanceTimersByTimeAsync(25)
      await rejection
      expect(
        coordinator.rejectOperation('session-timeout', 'operation-timeout', new Error('late')),
      ).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})
