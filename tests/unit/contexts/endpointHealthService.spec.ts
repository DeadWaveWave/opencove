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
}) {
  const accessByEndpointId = new Map([[options.access.endpoint.endpointId, options.access]])
  const endpoints = options.listEndpoints ?? [options.access.endpoint]

  const topology: WorkerTopologyStore = {
    listEndpoints: async () => ({ endpoints }),
    registerEndpoint: async () => {
      throw new Error('not used')
    },
    registerManagedSshEndpoint: async () => {
      throw new Error('not used')
    },
    removeEndpoint: async () => undefined,
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
    prepare: async () => ({
      connection: null,
      snapshot: {
        endpointId: 'managed-1',
        status: 'idle',
        localPort: null,
        lastError: null,
        stderrTail: '',
      },
      bootstrapRan: false,
    }),
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
  })
}

describe('endpointHealthService', () => {
  beforeEach(() => {
    invokeControlSurfaceMock.mockReset()
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
        }),
      },
    })

    const result = await service.listOverviews()
    const overview = result.endpoints[0]

    expect(overview?.status).toBe('auth_failed')
    expect(overview?.recommendedAction).toBe('repair_credentials')
  })

  it('restarts the managed tunnel when repairing credentials', async () => {
    const managedAccess = createManagedAccess()
    invokeControlSurfaceMock.mockResolvedValue({
      httpStatus: 200,
      result: {
        __opencoveControlEnvelope: true,
        ok: true,
        value: {
          protocolVersion: CONTROL_SURFACE_PROTOCOL_VERSION,
          appVersion: '1.2.3',
          pid: 42,
        },
      },
    })

    const prepare = vi.fn(async () => ({
      connection: {
        hostname: '127.0.0.1',
        port: 41012,
        token: managedAccess.token,
      },
      snapshot: {
        endpointId: managedAccess.endpoint.endpointId,
        status: 'ready' as const,
        localPort: 41012,
        lastError: null,
        stderrTail: '',
      },
      bootstrapRan: true,
    }))
    const service = createSubject({
      access: managedAccess,
      managedRuntime: {
        prepare,
      },
    })

    const result = await service.repairEndpoint({
      endpointId: managedAccess.endpoint.endpointId,
      action: 'repair_credentials',
    })

    expect(result.overview.status).toBe('connected')
    expect(prepare).toHaveBeenCalledWith(
      {
        endpointId: managedAccess.endpoint.endpointId,
        displayName: managedAccess.endpoint.displayName,
        token: managedAccess.token,
        ssh: managedAccess.managedSsh,
      },
      {
        restartTunnel: true,
        reinstallRuntime: false,
        allowBootstrap: true,
      },
    )
  })

  it('reinstalls the managed runtime when updating a mismatched endpoint', async () => {
    const managedAccess = createManagedAccess()
    invokeControlSurfaceMock.mockResolvedValue({
      httpStatus: 200,
      result: {
        __opencoveControlEnvelope: true,
        ok: true,
        value: {
          protocolVersion: CONTROL_SURFACE_PROTOCOL_VERSION,
          appVersion: '1.2.4',
          pid: 84,
        },
      },
    })

    const prepare = vi.fn(async () => ({
      connection: {
        hostname: '127.0.0.1',
        port: 41013,
        token: managedAccess.token,
      },
      snapshot: {
        endpointId: managedAccess.endpoint.endpointId,
        status: 'ready' as const,
        localPort: 41013,
        lastError: null,
        stderrTail: '',
      },
      bootstrapRan: true,
    }))
    const service = createSubject({
      access: managedAccess,
      managedRuntime: {
        prepare,
      },
    })

    const result = await service.repairEndpoint({
      endpointId: managedAccess.endpoint.endpointId,
      action: 'update_runtime',
    })

    expect(result.overview.status).toBe('connected')
    expect(prepare).toHaveBeenCalledWith(
      {
        endpointId: managedAccess.endpoint.endpointId,
        displayName: managedAccess.endpoint.displayName,
        token: managedAccess.token,
        ssh: managedAccess.managedSsh,
      },
      {
        restartTunnel: false,
        reinstallRuntime: true,
        allowBootstrap: true,
      },
    )
  })
})
