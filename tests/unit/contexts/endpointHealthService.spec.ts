import { ManagedSshEndpointOperationOwner } from '../../../src/contexts/topology/application/ManagedSshEndpointOperationOwner'
import type {
  ManagedSshEndpointPreparationRequest,
  ManagedSshEndpointPreparationResult,
} from '../../../src/contexts/topology/application/ports/ManagedSshEndpointPreparationPort'
import { CONTROL_SURFACE_PROTOCOL_VERSION } from '../../../src/shared/contracts/controlSurface'
import { createEndpointHealthService } from '../../../src/app/main/controlSurface/topology/endpointHealthService'
import type { ManagedSshEndpointRuntime } from '../../../src/app/main/controlSurface/topology/managedSshEndpointRuntime'
import type { WorkerTopologyStore } from '../../../src/app/main/controlSurface/topology/topologyStore'
import type { EndpointRuntimeAccess } from '../../../src/app/main/controlSurface/topology/topologyEndpointAccess'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { invokeControlSurfaceMock } = vi.hoisted(() => ({
  invokeControlSurfaceMock: vi.fn(),
}))

vi.mock('../../../src/app/main/controlSurface/remote/controlSurfaceHttpClient', () => ({
  invokeControlSurface: invokeControlSurfaceMock,
}))

function createManualAccess(): Extract<EndpointRuntimeAccess, { kind: 'manual' }> {
  return {
    kind: 'manual',
    token: 'manual-token',
    connection: {
      hostname: 'manual.example.com',
      port: 39291,
      token: 'manual-token',
    },
    endpoint: {
      endpointId: 'manual-1',
      kind: 'remote_worker',
      displayName: 'Manual Box',
      createdAt: '2026-05-02T00:00:00.000Z',
      updatedAt: '2026-05-02T00:00:00.000Z',
      access: {
        kind: 'manual',
        managedSsh: null,
      },
      remote: {
        hostname: 'manual.example.com',
        port: 39291,
      },
    },
  }
}

function createManagedAccess(): Extract<EndpointRuntimeAccess, { kind: 'managed_ssh' }> {
  return {
    kind: 'managed_ssh',
    token: 'managed-token',
    managedSsh: {
      host: 'managed.example.com',
      port: 22,
      username: 'ubuntu',
      remotePort: 39291,
      remotePlatform: 'auto',
    },
    endpoint: {
      endpointId: 'managed-1',
      kind: 'remote_worker',
      displayName: 'Managed Box',
      createdAt: '2026-05-02T00:00:00.000Z',
      updatedAt: '2026-05-02T00:00:00.000Z',
      access: {
        kind: 'managed_ssh',
        managedSsh: {
          host: 'managed.example.com',
          port: 22,
          username: 'ubuntu',
          remotePort: 39291,
          remotePlatform: 'auto',
        },
      },
      remote: null,
    },
  }
}

function createSubject(options: {
  access: EndpointRuntimeAccess
  managedRuntime?: Partial<ManagedSshEndpointRuntime>
  listEndpoints?: Array<EndpointRuntimeAccess['endpoint']>
  dependentMountCount?: number
}) {
  const accessByEndpointId = new Map([[options.access.endpoint.endpointId, options.access]])
  const endpoints = options.listEndpoints ?? [options.access.endpoint]
  const dependentMountCount = options.dependentMountCount ?? 0

  const topology: WorkerTopologyStore = {
    listEndpoints: async () => ({ endpoints }),
    registerEndpoint: async () => {
      throw new Error('not used')
    },
    registerManagedSshEndpoint: async () => {
      throw new Error('not used')
    },
    updateManagedSshEndpoint: async () => {
      throw new Error('not used')
    },
    removeEndpoint: async () => ({ removedMountCount: 0 }),
    getEndpointRemovalImpact: async () => ({ mountIds: [], mountCount: dependentMountCount }),
    getEndpointRemovalImpacts: async endpointIds =>
      new Map(
        endpointIds.map(endpointId => [
          endpointId,
          { mountIds: [], mountCount: dependentMountCount },
        ]),
      ),
    resolveEndpointRuntimeAccess: async endpointId => accessByEndpointId.get(endpointId) ?? null,
    resolveRemoteEndpointConnection: async () => null,
    listMounts: async () => ({ projectId: 'project', mounts: [] }),
    createMount: async () => {
      throw new Error('not used')
    },
    removeMount: async () => undefined,
    promoteMount: async () => undefined,
    resolveMountTarget: async () => null,
  }

  const managedRuntime: ManagedSshEndpointRuntime = {
    resolveConnection: async () => null,
    disposeEndpoint: async () => undefined,
    execute: async () => ({ status: 'ready' }),
    getSnapshot: () => null,
    getSshAvailability: async () => ({
      toolId: 'ssh',
      command: 'ssh',
      executablePath: '/usr/bin/ssh',
      source: 'path',
      status: 'resolved',
      diagnostics: [],
    }),
    dispose: async () => undefined,
    ...options.managedRuntime,
  }

  return createEndpointHealthService({
    topology,
    managedRuntime,
    operations: new ManagedSshEndpointOperationOwner({
      preparationPort: managedRuntime,
      createOperationId: () => 'operation-test',
      now: Date.now,
    }),
  })
}

describe('endpointHealthService', () => {
  beforeEach(() => {
    invokeControlSurfaceMock.mockReset()
  })

  it('projects the current operation instead of an older in-flight capability probe', async () => {
    let releaseProbe!: () => void
    let probeStarted!: () => void
    const started = new Promise<void>(resolve => {
      probeStarted = resolve
    })
    invokeControlSurfaceMock.mockImplementation(async () => {
      probeStarted()
      await new Promise<void>(resolve => {
        releaseProbe = resolve
      })
      return { httpStatus: 503, result: null }
    })
    let releasePreparation!: () => void
    const preparation = new Promise<void>(resolve => {
      releasePreparation = resolve
    })
    const service = createSubject({
      access: createManagedAccess(),
      managedRuntime: {
        getSnapshot: () => ({
          endpointId: 'managed-1',
          status: 'ready',
          localPort: 41011,
          lastError: null,
          stderrTail: '',
          failureKind: null,
        }),
        execute: async () => {
          await preparation
          return { status: 'ready' }
        },
      },
    })
    const query = service.listOverviews()
    await started
    const accepted = await service.prepareEndpoint({ endpointId: 'managed-1' })
    releaseProbe()
    const result = await query
    expect(result.endpoints[0]?.operation?.operationId).toBe(
      accepted.overview.operation?.operationId,
    )
    expect(result.endpoints[0]?.status).toBe('connecting')
    releasePreparation()
  })

  it('keeps manual auth failures as diagnostic-only instead of offering credential repair', async () => {
    invokeControlSurfaceMock.mockResolvedValue({
      httpStatus: 401,
      result: null,
    })

    const service = createSubject({
      access: createManualAccess(),
    })

    const result = await service.listOverviews()
    const overview = result.endpoints[0]

    expect(overview?.status).toBe('auth_failed')
    expect(overview?.recommendedAction).toBe('show_details')
    expect(overview?.canBrowse).toBe(false)
  })

  it('offers credential repair for managed auth failures', async () => {
    invokeControlSurfaceMock.mockResolvedValue({
      httpStatus: 401,
      result: null,
    })

    const managedAccess = createManagedAccess()
    const service = createSubject({
      access: managedAccess,
      managedRuntime: {
        getSnapshot: () => ({
          endpointId: managedAccess.endpoint.endpointId,
          status: 'ready',
          localPort: 41011,
          lastError: null,
          stderrTail: '',
          failureKind: null,
        }),
      },
    })

    const result = await service.listOverviews()
    const overview = result.endpoints[0]

    expect(overview?.status).toBe('auth_failed')
    expect(overview?.recommendedAction).toBe('repair_credentials')
  })

  it.each([
    {
      failureKind: 'runtime_corrupt' as const,
      status: 'runtime_corrupt',
      recommendedAction: 'install_runtime',
      detail: 'dyld: Library not loaded: Electron Framework',
    },
    {
      failureKind: 'installer_unavailable' as const,
      status: 'installer_unavailable',
      recommendedAction: 'retry',
      detail: 'curl: (22) The requested URL returned error: 404',
    },
    {
      failureKind: 'runtime_unmanaged' as const,
      status: 'runtime_unmanaged',
      recommendedAction: 'show_details',
      detail: 'Refusing to replace /usr/local/bin/opencove.',
    },
  ])(
    'projects managed bootstrap diagnosis $failureKind into an actionable endpoint error',
    async ({ failureKind, status, recommendedAction, detail }) => {
      const managedAccess = createManagedAccess()
      const service = createSubject({
        access: managedAccess,
        managedRuntime: {
          getSnapshot: () => ({
            endpointId: managedAccess.endpoint.endpointId,
            status: 'error',
            localPort: null,
            lastError: detail,
            stderrTail: '',
            failureKind,
          }),
        },
      })

      const result = await service.listOverviews()
      const overview = result.endpoints[0]

      expect(overview?.status).toBe(status)
      expect(overview?.recommendedAction).toBe(recommendedAction)
      expect(overview?.details).toContain(detail)
    },
  )

  it.each(['prepare', 'repair'] as const)(
    'returns accepted %s before bootstrap resolves and monitors terminal outcome',
    async kind => {
      let release!: (result: ManagedSshEndpointPreparationResult) => void
      const gate = new Promise<ManagedSshEndpointPreparationResult>(resolve => {
        release = resolve
      })
      let request!: ManagedSshEndpointPreparationRequest
      const execute = vi.fn(async (input: ManagedSshEndpointPreparationRequest) => {
        request = input
        return await gate
      })
      let ready = false
      const service = createSubject({
        access: createManagedAccess(),
        dependentMountCount: 3,
        managedRuntime: {
          execute,
          getSnapshot: () => ({
            endpointId: 'managed-1',
            status: ready ? 'ready' : 'connecting',
            localPort: ready ? 41012 : null,
            lastError: null,
            stderrTail: 'channel 1: open failed: connect failed: Connection refused',
            failureKind: null,
          }),
        },
      })
      const result =
        kind === 'prepare'
          ? await service.prepareEndpoint({ endpointId: 'managed-1', reason: 'connect' })
          : await service.repairEndpoint({ endpointId: 'managed-1', action: 'update_runtime' })
      expect(result.overview).toMatchObject({
        status: 'connecting',
        canBrowse: false,
        details: [],
        dependentMountCount: 3,
        operation: { operationId: 'operation-test', revision: 1, kind },
      })
      expect(execute).toHaveBeenCalledTimes(1)
      expect(request.reinstallRuntime).toBe(kind === 'repair')
      expect(invokeControlSurfaceMock).not.toHaveBeenCalled()
      request.reportPhase('installing_runtime')
      expect((await service.listOverviews()).endpoints[0]?.operation).toMatchObject({
        phase: 'installing_runtime',
        revision: 2,
      })
      expect(invokeControlSurfaceMock).not.toHaveBeenCalled()
      ready = true
      invokeControlSurfaceMock.mockResolvedValue({
        httpStatus: 200,
        result: {
          ok: true,
          value: {
            protocolVersion: CONTROL_SURFACE_PROTOCOL_VERSION,
            appVersion: '0.3.0',
            pid: 42,
          },
        },
      })
      release({ status: 'ready' })
      // Join the adapter promise; the next public query observes owner settlement.
      await gate
      await Promise.resolve()
      const overview = (await service.listOverviews()).endpoints[0]
      expect(overview).toMatchObject({
        status: 'connected',
        canBrowse: true,
        operation: null,
        dependentMountCount: 3,
      })
    },
  )

  it('does not repeat lastError and stderrTail or channel-number variants in final details', async () => {
    const detail =
      'channel 1: open failed: connect failed: Connection refused\nchannel 2: open failed: connect failed: Connection refused'
    const service = createSubject({
      access: createManagedAccess(),
      managedRuntime: {
        getSnapshot: () => ({
          endpointId: 'managed-1',
          status: 'error',
          localPort: null,
          lastError: detail,
          stderrTail: detail,
          failureKind: 'tunnel_failed',
        }),
      },
    })
    expect((await service.listOverviews()).endpoints[0]?.details).toEqual([
      'SSH channel: open failed: connect failed: Connection refused',
    ])
  })
})
