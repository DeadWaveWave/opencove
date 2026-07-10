import { describe, expect, it, vi } from 'vitest'
import { createRemotePtyRuntimeGeometryCoordinator } from '../../../src/app/main/controlSurface/remote/remotePtyRuntime.geometryCoordinator'

describe('remote PTY runtime geometry coordinator', () => {
  it('keeps renderer-to-home CAS and downstream authority on modern ACK requests', async () => {
    const coordinator = createRemotePtyRuntimeGeometryCoordinator()
    coordinator.noteAckCapability(true)
    const send = vi.fn(async () => undefined)
    const pending = coordinator.resize({
      request: {
        sessionId: 'session-modern',
        cols: 100,
        rows: 32,
        reason: 'frame_commit',
        operationId: 'operation-modern',
        baseGeometryRevision: 4,
        authorityEpoch: 99,
      },
      authority: { role: 'controller', epoch: 3 },
      timeoutMs: 1_000,
      send,
    })
    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledTimes(1)
    })
    expect(send).toHaveBeenCalledWith({
      type: 'resize',
      sessionId: 'session-modern',
      cols: 100,
      rows: 32,
      reason: 'frame_commit',
      operationId: 'operation-modern',
      baseGeometryRevision: 4,
      authorityEpoch: 3,
    })

    coordinator.handleResizeResult({
      sessionId: 'session-modern',
      operationId: 'operation-modern',
      status: 'accepted',
      changed: true,
      geometry: { cols: 100, rows: 32, revision: 5 },
      authority: { role: 'controller', epoch: 3 },
    })
    await expect(pending).resolves.toMatchObject({ status: 'accepted' })
  })

  it('uses a local legacy revision and resolves from the matching geometry event', async () => {
    const coordinator = createRemotePtyRuntimeGeometryCoordinator()
    coordinator.noteAckCapability(false)
    coordinator.notePresentationRevision('session-legacy', 5)
    const send = vi.fn(async () => undefined)
    const pending = coordinator.resize({
      request: {
        sessionId: 'session-legacy',
        cols: 120,
        rows: 40,
        reason: 'appearance_commit',
        operationId: 'operation-legacy',
      },
      authority: { role: 'controller', epoch: 7 },
      timeoutMs: 1_000,
      send,
    })
    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledTimes(1)
    })
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId: 'operation-legacy',
        revision: 6,
        authorityEpoch: 7,
      }),
    )

    coordinator.handleGeometry(
      {
        sessionId: 'session-legacy',
        cols: 120,
        rows: 40,
        reason: 'appearance_commit',
        revision: 6,
      },
      { role: 'controller', epoch: 7 },
    )
    await expect(pending).resolves.toEqual({
      sessionId: 'session-legacy',
      operationId: 'operation-legacy',
      status: 'accepted',
      changed: true,
      geometry: { cols: 120, rows: 40, revision: 6 },
      authority: { role: 'controller', epoch: 7 },
    })
  })
})
