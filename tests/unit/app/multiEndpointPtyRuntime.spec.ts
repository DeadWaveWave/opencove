import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createMultiEndpointPtyRuntime,
  RemotePtyRecoveryBlockedError,
} from '../../../src/app/main/controlSurface/ptyStream/multiEndpointPtyRuntime'
import { RemotePtyEndpointProxy } from '../../../src/app/main/controlSurface/ptyStream/remotePtyEndpointProxy'
import type { ControlSurfacePtyRuntime } from '../../../src/app/main/controlSurface/handlers/sessionPtyRuntime'
import type { WorkerTopologyStore } from '../../../src/app/main/controlSurface/topology/topologyStore'

function createRuntimeMock(
  overrides: Partial<ControlSurfacePtyRuntime> = {},
): ControlSurfacePtyRuntime {
  return {
    listProfiles: vi.fn(async () => ({
      profiles: [{ id: 'powershell', label: 'PowerShell', runtimeKind: 'windows' }],
      defaultProfileId: 'powershell',
    })),
    spawnSession: vi.fn(async () => ({ sessionId: 'session-1' })),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    onData: vi.fn(() => () => undefined),
    onExit: vi.fn(() => () => undefined),
    ...overrides,
  }
}

describe('createMultiEndpointPtyRuntime', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('forwards terminal profile discovery to the local runtime', async () => {
    const localRuntime = createRuntimeMock()
    const runtime = createMultiEndpointPtyRuntime({
      localRuntime,
      topology: {} as WorkerTopologyStore,
      disposeLocalRuntime: false,
    })

    await expect(runtime.listProfiles?.()).resolves.toEqual({
      profiles: [{ id: 'powershell', label: 'PowerShell', runtimeKind: 'windows' }],
      defaultProfileId: 'powershell',
    })
    expect(localRuntime.listProfiles).toHaveBeenCalledTimes(1)

    runtime.dispose()
  })

  it('restores a still-running remote session under its durable home session id', async () => {
    vi.spyOn(RemotePtyEndpointProxy.prototype, 'findSession').mockResolvedValue({
      sessionId: 'remote-session-1',
      kind: 'terminal',
      startedAt: '2026-07-10T00:00:00.000Z',
      cwd: '/remote/workspace',
      command: 'shell',
      args: [],
      status: 'running',
      exitCode: null,
      seq: 4,
      earliestSeq: 1,
      controller: null,
    })
    const remotePresentationSnapshot = {
      sessionId: 'remote-session-1',
      epoch: 1,
      appliedSeq: 20,
      presentationRevision: 4,
      cols: 80,
      rows: 24,
      geometryRevision: 1,
      bufferKind: 'normal' as const,
      cursor: { x: 0, y: 0 },
      title: null,
      serializedScreen: 'authoritative remote screen',
    }
    vi.spyOn(RemotePtyEndpointProxy.prototype, 'presentationSnapshot').mockResolvedValue(
      remotePresentationSnapshot,
    )
    const attach = vi
      .spyOn(RemotePtyEndpointProxy.prototype, 'attach')
      .mockImplementation(() => undefined)
    let captureDuringBaseline: Promise<unknown> | null = null
    const captureSnapshot = vi.fn(async () => 'AUTHORITATIVE_HOME_BASELINE')
    const beforeAttach = vi.fn(async (_session, _snapshot, publishRecoveryBaseline) => {
      captureDuringBaseline = runtime.captureRecoveryPresentationSnapshot(
        'home-session-1',
        captureSnapshot,
      )
      await Promise.resolve()
      expect(captureSnapshot).not.toHaveBeenCalled()
      publishRecoveryBaseline()
      await captureDuringBaseline
    })
    vi.spyOn(RemotePtyEndpointProxy.prototype, 'resolveServerInstanceId').mockResolvedValue(null)
    const runtime = createMultiEndpointPtyRuntime({
      localRuntime: createRuntimeMock(),
      topology: {} as WorkerTopologyStore,
      disposeLocalRuntime: false,
    })

    await expect(
      runtime.restoreRemoteSession({
        homeSessionId: 'home-session-1',
        endpointId: 'endpoint-1',
        remoteSessionId: 'remote-session-1',
        afterSeq: 12,
        beforeAttach,
      }),
    ).resolves.toMatchObject({ sessionId: 'remote-session-1', status: 'running' })
    expect(beforeAttach).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'remote-session-1', status: 'running' }),
      remotePresentationSnapshot,
      expect.any(Function),
    )
    await expect(captureDuringBaseline).resolves.toMatchObject({
      snapshot: 'AUTHORITATIVE_HOME_BASELINE',
      downstreamReplayCursor: 20,
    })
    expect(attach).toHaveBeenCalledWith('remote-session-1', 20)
    expect(beforeAttach.mock.invocationCallOrder[0]).toBeLessThan(
      attach.mock.invocationCallOrder[0]!,
    )
    await expect(
      runtime.resolveRecoveryRoute('home-session-1', 'home-worker-new'),
    ).resolves.toEqual({
      kind: 'remote',
      homeWorkerInstanceId: 'home-worker-new',
      endpointId: 'endpoint-1',
      remoteSessionId: 'remote-session-1',
      targetWorkerInstanceId: null,
    })

    runtime.dispose()
  })

  it('captures an exited remote session without reattaching it as live', async () => {
    vi.spyOn(RemotePtyEndpointProxy.prototype, 'findSession').mockResolvedValue({
      sessionId: 'remote-session-exited',
      kind: 'terminal',
      startedAt: '2026-07-10T00:00:00.000Z',
      cwd: '/remote/workspace',
      command: 'shell',
      args: [],
      status: 'exited',
      exitCode: 0,
      seq: 8,
      earliestSeq: 1,
      controller: null,
    })
    vi.spyOn(RemotePtyEndpointProxy.prototype, 'presentationSnapshot').mockResolvedValue({
      sessionId: 'remote-session-exited',
      epoch: 1,
      appliedSeq: 8,
      presentationRevision: 4,
      cols: 80,
      rows: 24,
      geometryRevision: 1,
      bufferKind: 'normal',
      cursor: { x: 0, y: 0 },
      title: null,
      serializedScreen: 'FINAL_REMOTE_FRAME',
    })
    const attach = vi
      .spyOn(RemotePtyEndpointProxy.prototype, 'attach')
      .mockImplementation(() => undefined)
    const beforeAttach = vi.fn(async (_session, _snapshot, publishRecoveryBaseline) => {
      publishRecoveryBaseline()
    })
    const runtime = createMultiEndpointPtyRuntime({
      localRuntime: createRuntimeMock(),
      topology: {} as WorkerTopologyStore,
      disposeLocalRuntime: false,
    })

    await expect(
      runtime.restoreRemoteSession({
        homeSessionId: 'home-session-exited',
        endpointId: 'endpoint-1',
        remoteSessionId: 'remote-session-exited',
        beforeAttach,
      }),
    ).resolves.toMatchObject({ status: 'exited', exitCode: 0 })
    expect(beforeAttach).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'exited' }),
      expect.objectContaining({ serializedScreen: 'FINAL_REMOTE_FRAME', appliedSeq: 8 }),
      expect.any(Function),
    )
    expect(attach).not.toHaveBeenCalled()
    await expect(
      runtime.resolveRecoveryRoute('home-session-exited', 'home-worker'),
    ).resolves.toBeNull()

    runtime.dispose()
  })

  it.each([
    { status: 'exited' as const, afterSeq: 7 },
    { status: 'running' as const, afterSeq: null },
  ])(
    'blocks $status recovery when no authoritative snapshot is available',
    async ({ status, afterSeq }) => {
      vi.spyOn(RemotePtyEndpointProxy.prototype, 'findSession').mockResolvedValue({
        sessionId: 'remote-session-blocked',
        kind: 'terminal',
        startedAt: '2026-07-10T00:00:00.000Z',
        cwd: '/remote/workspace',
        command: 'shell',
        args: [],
        status,
        exitCode: status === 'exited' ? 0 : null,
        seq: 8,
        earliestSeq: 1,
        controller: null,
      })
      vi.spyOn(RemotePtyEndpointProxy.prototype, 'presentationSnapshot').mockRejectedValue(
        new Error('snapshot unavailable'),
      )
      const attach = vi
        .spyOn(RemotePtyEndpointProxy.prototype, 'attach')
        .mockImplementation(() => undefined)
      const beforeAttach = vi.fn(async (_session, _snapshot, publishRecoveryBaseline) => {
        publishRecoveryBaseline()
      })
      const runtime = createMultiEndpointPtyRuntime({
        localRuntime: createRuntimeMock(),
        topology: {} as WorkerTopologyStore,
        disposeLocalRuntime: false,
      })

      await expect(
        runtime.restoreRemoteSession({
          homeSessionId: 'home-session-blocked',
          endpointId: 'endpoint-1',
          remoteSessionId: 'remote-session-blocked',
          afterSeq,
          beforeAttach,
        }),
      ).rejects.toBeInstanceOf(RemotePtyRecoveryBlockedError)
      expect(beforeAttach).not.toHaveBeenCalled()
      expect(attach).not.toHaveBeenCalled()
      runtime.dispose()
    },
  )

  it('falls back to a durable cursor for a running session when snapshot fetch fails', async () => {
    vi.spyOn(RemotePtyEndpointProxy.prototype, 'findSession').mockResolvedValue({
      sessionId: 'remote-session-fallback',
      kind: 'terminal',
      startedAt: '2026-07-10T00:00:00.000Z',
      cwd: '/remote/workspace',
      command: 'shell',
      args: [],
      status: 'running',
      exitCode: null,
      seq: 8,
      earliestSeq: 1,
      controller: null,
    })
    vi.spyOn(RemotePtyEndpointProxy.prototype, 'presentationSnapshot').mockRejectedValue(
      new Error('snapshot unavailable'),
    )
    const attach = vi
      .spyOn(RemotePtyEndpointProxy.prototype, 'attach')
      .mockImplementation(() => undefined)
    const beforeAttach = vi.fn(async (_session, _snapshot, publishRecoveryBaseline) => {
      publishRecoveryBaseline()
    })
    const runtime = createMultiEndpointPtyRuntime({
      localRuntime: createRuntimeMock(),
      topology: {} as WorkerTopologyStore,
      disposeLocalRuntime: false,
    })

    await expect(
      runtime.restoreRemoteSession({
        homeSessionId: 'home-session-fallback',
        endpointId: 'endpoint-1',
        remoteSessionId: 'remote-session-fallback',
        afterSeq: 7,
        beforeAttach,
      }),
    ).resolves.toMatchObject({ status: 'running' })
    expect(beforeAttach).toHaveBeenCalledWith(expect.any(Object), null, expect.any(Function))
    expect(attach).toHaveBeenCalledWith('remote-session-fallback', 7)
    runtime.dispose()
  })

  it('keeps home and remote geometry revisions local to their own hubs', async () => {
    vi.spyOn(RemotePtyEndpointProxy.prototype, 'attach').mockImplementation(() => undefined)
    const remoteResize = vi
      .spyOn(RemotePtyEndpointProxy.prototype, 'resize')
      .mockImplementation(async input => ({
        sessionId: input.sessionId,
        operationId: input.operationId ?? 'remote-operation',
        status: 'accepted',
        changed: true,
        geometry: { cols: input.cols, rows: input.rows, revision: 7 },
        authority: { role: 'controller', epoch: 5 },
      }))
    const runtime = createMultiEndpointPtyRuntime({
      localRuntime: createRuntimeMock(),
      topology: {} as WorkerTopologyStore,
      disposeLocalRuntime: false,
    })
    const homeSessionId = runtime.registerRemoteSession({
      endpointId: 'endpoint-1',
      remoteSessionId: 'remote-session-1',
    })

    await expect(
      runtime.resize({
        sessionId: homeSessionId,
        cols: 120,
        rows: 40,
        reason: 'frame_commit',
        operationId: 'home-operation-revision-2',
        baseGeometryRevision: 2,
        authorityEpoch: 4,
        revision: 3,
      }),
    ).resolves.toMatchObject({
      sessionId: homeSessionId,
      status: 'accepted',
      geometry: { cols: 120, rows: 40, revision: 7 },
    })

    expect(remoteResize).toHaveBeenCalledTimes(1)
    const downstreamInput = remoteResize.mock.calls[0]![0]
    expect(downstreamInput).toMatchObject({
      sessionId: 'remote-session-1',
      cols: 120,
      rows: 40,
      operationId: 'home-operation-revision-2',
    })
    expect(downstreamInput).not.toHaveProperty('baseGeometryRevision')
    expect(downstreamInput).not.toHaveProperty('authorityEpoch')
    expect(downstreamInput).not.toHaveProperty('revision')

    runtime.dispose()
  })
})
