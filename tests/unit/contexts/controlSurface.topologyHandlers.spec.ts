import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import type { ControlSurfaceContext } from '../../../src/app/main/controlSurface/types'
import { registerTopologyHandlers } from '../../../src/app/main/controlSurface/handlers/topologyHandlers'
import type { EndpointHealthService } from '../../../src/app/main/controlSurface/topology/endpointHealthService'
import type { WorkerTopologyStore } from '../../../src/app/main/controlSurface/topology/topologyStore'

const { invokeControlSurfaceMock } = vi.hoisted(() => ({
  invokeControlSurfaceMock: vi.fn(),
}))

vi.mock('../../../src/app/main/controlSurface/remote/controlSurfaceHttpClient', () => ({
  invokeControlSurface: invokeControlSurfaceMock,
}))

const ctx: ControlSurfaceContext = {
  now: () => new Date('2026-04-12T00:00:00.000Z'),
  capabilities: {
    webShell: false,
    sync: { state: true, events: true },
    sessionStreaming: {
      enabled: true,
      ptyProtocolVersion: 1,
      replayWindowMaxBytes: 1000,
      roles: { viewer: true, controller: true },
      webAuth: { ticketToCookie: true, cookieSession: true },
    },
  },
}

function createSubject(options?: {
  topology?: Partial<WorkerTopologyStore>
  endpointHealth?: Partial<EndpointHealthService>
}) {
  const topology: WorkerTopologyStore = {
    listEndpoints: async () => ({ endpoints: [] }),
    registerEndpoint: async () => {
      throw new Error('not used')
    },
    registerManagedSshEndpoint: async () => {
      throw new Error('not used')
    },
    removeEndpoint: async () => undefined,
    resolveEndpointRuntimeAccess: async () => null,
    resolveRemoteEndpointConnection: async endpointId =>
      endpointId === 'remote' ? { hostname: 'example.com', port: 1234, token: 'token' } : null,
    listMounts: async () => ({ projectId: 'project', mounts: [] }),
    createMount: async () => {
      throw new Error('not used')
    },
    removeMount: async () => undefined,
    promoteMount: async () => undefined,
    resolveMountTarget: async () => null,
    ...options?.topology,
  }

  const endpointHealth: EndpointHealthService = {
    listOverviews: async () => ({ endpoints: [] }),
    prepareEndpoint: async input => ({
      overview: {
        endpoint: {
          endpointId: input.endpointId,
          kind: 'remote_worker',
          displayName: input.endpointId,
          createdAt: '2026-04-12T00:00:00.000Z',
          updatedAt: '2026-04-12T00:00:00.000Z',
          access: null,
          remote: null,
        },
        status: 'disconnected',
        summary: 'Not connected.',
        details: [],
        checkedAt: '2026-04-12T00:00:00.000Z',
        recommendedAction: 'connect',
        isManaged: false,
        canBrowse: false,
        runtime: {
          appVersion: null,
          protocolVersion: null,
          platform: null,
          pid: null,
        },
      },
    }),
    repairEndpoint: async input => ({
      overview: {
        endpoint: {
          endpointId: input.endpointId,
          kind: 'remote_worker',
          displayName: input.endpointId,
          createdAt: '2026-04-12T00:00:00.000Z',
          updatedAt: '2026-04-12T00:00:00.000Z',
          access: null,
          remote: null,
        },
        status: 'error',
        summary: 'Endpoint error.',
        details: [],
        checkedAt: '2026-04-12T00:00:00.000Z',
        recommendedAction: 'retry',
        isManaged: false,
        canBrowse: false,
        runtime: {
          appVersion: null,
          protocolVersion: null,
          platform: null,
          pid: null,
        },
      },
    }),
    ...options?.endpointHealth,
  }

  const controlSurface = createControlSurface()
  registerTopologyHandlers(controlSurface, {
    topology,
    approvedWorkspaces: {
      registerRoot: async () => undefined,
      isPathApproved: async () => true,
    },
    endpointHealth,
  })

  return { controlSurface, topology, endpointHealth }
}

describe('control surface topology handlers', () => {
  beforeEach(() => {
    invokeControlSurfaceMock.mockReset()
  })

  it('reads endpoint directories when approveRoot is unsupported on the remote', async () => {
    invokeControlSurfaceMock
      .mockResolvedValueOnce({
        httpStatus: 200,
        result: {
          __opencoveControlEnvelope: true,
          ok: false,
          error: {
            code: 'common.invalid_input',
            debugMessage: 'Error: Unknown control surface command: workspace.approveRoot',
          },
        },
      })
      .mockResolvedValueOnce({
        httpStatus: 200,
        result: {
          __opencoveControlEnvelope: true,
          ok: true,
          value: {
            entries: [
              { name: 'src', uri: 'file:///remote/src', kind: 'directory' },
              { name: 'README.md', uri: 'file:///remote/README.md', kind: 'file' },
            ],
          },
        },
      })

    const { controlSurface } = createSubject()

    const result = await controlSurface.invoke(ctx, {
      kind: 'query',
      id: 'endpoint.readDirectory',
      payload: { endpointId: 'remote', path: '/remote' },
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.entries).toHaveLength(2)
      expect(result.value.entries[0]?.name).toBe('src')
    }

    expect(invokeControlSurfaceMock).toHaveBeenCalledTimes(2)
    expect(invokeControlSurfaceMock.mock.calls[0]?.[1]).toMatchObject({
      kind: 'command',
      id: 'workspace.approveRoot',
    })
    expect(invokeControlSurfaceMock.mock.calls[1]?.[1]).toMatchObject({
      kind: 'query',
      id: 'filesystem.readDirectory',
    })
  })

  it('pings endpoints when system.ping is missing (fallback)', async () => {
    invokeControlSurfaceMock
      .mockResolvedValueOnce({
        httpStatus: 200,
        result: {
          __opencoveControlEnvelope: true,
          ok: false,
          error: {
            code: 'common.invalid_input',
            debugMessage: 'Error: Unknown control surface query: system.ping',
          },
        },
      })
      .mockResolvedValueOnce({
        httpStatus: 200,
        result: {
          __opencoveControlEnvelope: true,
          ok: true,
          value: {
            activeProjectId: null,
            projects: [],
          },
        },
      })

    const { controlSurface } = createSubject()

    const result = await controlSurface.invoke(ctx, {
      kind: 'query',
      id: 'endpoint.ping',
      payload: { endpointId: 'remote', timeoutMs: 250 },
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.ok).toBe(true)
      expect(result.value.endpointId).toBe('remote')
      expect(result.value.pid).toBe(0)
    }
  })

  it('returns a default home directory when system.homeDirectory is missing (fallback)', async () => {
    invokeControlSurfaceMock.mockResolvedValueOnce({
      httpStatus: 200,
      result: {
        __opencoveControlEnvelope: true,
        ok: false,
        error: {
          code: 'common.invalid_input',
          debugMessage: 'Error: Unknown control surface query: system.homeDirectory',
        },
      },
    })

    const { controlSurface } = createSubject()

    const result = await controlSurface.invoke(ctx, {
      kind: 'query',
      id: 'endpoint.homeDirectory',
      payload: { endpointId: 'remote' },
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toEqual({
        endpointId: 'remote',
        platform: 'unknown',
        homeDirectory: '/',
      })
    }
  })

  it('forwards endpoint overview queries to the endpoint health service', async () => {
    const listOverviews = vi.fn(async () => ({
      endpoints: [
        {
          endpoint: {
            endpointId: 'managed-1',
            kind: 'remote_worker' as const,
            displayName: 'SSH Box',
            createdAt: '2026-04-12T00:00:00.000Z',
            updatedAt: '2026-04-12T00:00:00.000Z',
            access: null,
            remote: null,
          },
          status: 'disconnected' as const,
          summary: 'Not connected.',
          details: [],
          checkedAt: '2026-04-12T00:00:00.000Z',
          recommendedAction: 'connect' as const,
          isManaged: true,
          canBrowse: false,
          runtime: {
            appVersion: null,
            protocolVersion: null,
            platform: null,
            pid: null,
          },
        },
      ],
    }))
    const { controlSurface } = createSubject({
      endpointHealth: { listOverviews },
    })

    const result = await controlSurface.invoke(ctx, {
      kind: 'query',
      id: 'endpoint.overview.list',
      payload: null,
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.endpoints).toHaveLength(1)
      expect(result.value.endpoints[0]?.endpoint.displayName).toBe('SSH Box')
    }
    expect(listOverviews).toHaveBeenCalledTimes(1)
  })

  it('forwards endpoint.prepare to the endpoint health service', async () => {
    const prepareEndpoint = vi.fn(async () => ({
      overview: {
        endpoint: {
          endpointId: 'managed-1',
          kind: 'remote_worker' as const,
          displayName: 'SSH Box',
          createdAt: '2026-04-12T00:00:00.000Z',
          updatedAt: '2026-04-12T00:00:00.000Z',
          access: null,
          remote: null,
        },
        status: 'connected' as const,
        summary: 'Connected.',
        details: [],
        checkedAt: '2026-04-12T00:00:00.000Z',
        recommendedAction: 'browse' as const,
        isManaged: true,
        canBrowse: true,
        runtime: {
          appVersion: null,
          protocolVersion: null,
          platform: null,
          pid: null,
        },
      },
    }))
    const { controlSurface } = createSubject({
      endpointHealth: { prepareEndpoint },
    })

    const result = await controlSurface.invoke(ctx, {
      kind: 'command',
      id: 'endpoint.prepare',
      payload: { endpointId: 'managed-1', reason: 'browse' },
    })

    expect(result.ok).toBe(true)
    expect(prepareEndpoint).toHaveBeenCalledWith({
      endpointId: 'managed-1',
      reason: 'browse',
    })
  })

  it('forwards endpoint.repair to the endpoint health service', async () => {
    const repairEndpoint = vi.fn(async () => ({
      overview: {
        endpoint: {
          endpointId: 'managed-1',
          kind: 'remote_worker' as const,
          displayName: 'SSH Box',
          createdAt: '2026-04-12T00:00:00.000Z',
          updatedAt: '2026-04-12T00:00:00.000Z',
          access: null,
          remote: null,
        },
        status: 'connected' as const,
        summary: 'Connected.',
        details: [],
        checkedAt: '2026-04-12T00:00:00.000Z',
        recommendedAction: 'browse' as const,
        isManaged: true,
        canBrowse: true,
        runtime: {
          appVersion: null,
          protocolVersion: null,
          platform: null,
          pid: null,
        },
      },
    }))
    const { controlSurface } = createSubject({
      endpointHealth: { repairEndpoint },
    })

    const result = await controlSurface.invoke(ctx, {
      kind: 'command',
      id: 'endpoint.repair',
      payload: { endpointId: 'managed-1', action: 'repair_tunnel' },
    })

    expect(result.ok).toBe(true)
    expect(repairEndpoint).toHaveBeenCalledWith({
      endpointId: 'managed-1',
      action: 'repair_tunnel',
    })
  })

  it('forwards managed SSH registration to the topology store', async () => {
    const registerManagedSshEndpoint = vi.fn(async () => ({
      endpoint: {
        endpointId: 'managed-1',
        kind: 'remote_worker' as const,
        displayName: 'SSH Box',
        createdAt: '2026-04-12T00:00:00.000Z',
        updatedAt: '2026-04-12T00:00:00.000Z',
        access: {
          kind: 'managed_ssh' as const,
          managedSsh: {
            host: 'example.com',
            port: 22,
            username: 'ubuntu',
            remotePort: 39291,
            remotePlatform: 'auto' as const,
          },
        },
        remote: null,
      },
    }))
    const { controlSurface } = createSubject({
      topology: { registerManagedSshEndpoint },
    })

    const result = await controlSurface.invoke(ctx, {
      kind: 'command',
      id: 'endpoint.registerManagedSsh',
      payload: {
        displayName: 'SSH Box',
        host: 'example.com',
        port: 22,
        username: 'ubuntu',
        remotePort: 39291,
        remotePlatform: 'auto',
      },
    })

    expect(result.ok).toBe(true)
    expect(registerManagedSshEndpoint).toHaveBeenCalledWith({
      displayName: 'SSH Box',
      host: 'example.com',
      port: 22,
      username: 'ubuntu',
      remotePort: 39291,
      remotePlatform: 'auto',
    })
  })
})
