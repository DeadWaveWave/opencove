import { describe, expect, it, vi } from 'vitest'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { registerTopologyHandlers } from '../../../src/app/main/controlSurface/handlers/topologyHandlers'
import type { ControlSurfaceContext } from '../../../src/app/main/controlSurface/types'
import type { EndpointHealthService } from '../../../src/app/main/controlSurface/topology/endpointHealthService'
import type { WorkerTopologyStore } from '../../../src/app/main/controlSurface/topology/topologyStore'

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

function createSubject(options: {
  updateManagedSshEndpoint: WorkerTopologyStore['updateManagedSshEndpoint']
  registerManagedSshEndpoint?: WorkerTopologyStore['registerManagedSshEndpoint']
  prepareEndpoint?: EndpointHealthService['prepareEndpoint']
}) {
  const topology = {
    listEndpoints: async () => ({ endpoints: [] }),
    registerEndpoint: vi.fn(),
    registerManagedSshEndpoint: options.registerManagedSshEndpoint ?? vi.fn(),
    updateManagedSshEndpoint: options.updateManagedSshEndpoint,
    removeEndpoint: async () => ({ removedMountCount: 0 }),
    getEndpointRemovalImpact: async () => ({ mountIds: [], mountCount: 0 }),
    resolveEndpointRuntimeAccess: async () => null,
    resolveRemoteEndpointConnection: async () => null,
    listMounts: async () => ({ projectId: 'project', mounts: [] }),
    createMount: vi.fn(),
    removeMount: async () => undefined,
    promoteMount: async () => undefined,
    resolveMountTarget: async () => null,
  } satisfies WorkerTopologyStore
  const prepareEndpoint = options.prepareEndpoint ?? vi.fn()
  const endpointHealth = {
    listOverviews: async () => ({ endpoints: [] }),
    prepareEndpoint,
    repairEndpoint: vi.fn(),
  } satisfies EndpointHealthService
  const controlSurface = createControlSurface()
  registerTopologyHandlers(controlSurface, {
    topology,
    endpointHealth,
    approvedWorkspaces: { registerRoot: async () => undefined, isPathApproved: async () => true },
  })
  return { controlSurface, prepareEndpoint }
}

describe('control surface managed SSH update', () => {
  it.each([
    ['endpoint.registerManagedSsh', { host: 'example.com', port: 'abc' }],
    [
      'endpoint.updateManagedSsh',
      { endpointId: 'managed-1', host: 'example.com', port: 70_000, remotePort: 39_291 },
    ],
  ])('rejects illegal managed SSH ports for %s', async (id, payload) => {
    const registerManagedSshEndpoint = vi.fn()
    const updateManagedSshEndpoint = vi.fn()
    const { controlSurface } = createSubject({
      registerManagedSshEndpoint,
      updateManagedSshEndpoint,
    })

    const result = await controlSurface.invoke(ctx, { kind: 'command', id, payload })

    expect(result.ok).toBe(false)
    expect(registerManagedSshEndpoint).not.toHaveBeenCalled()
    expect(updateManagedSshEndpoint).not.toHaveBeenCalled()
  })

  it('updates durable configuration and prepares a replacement tunnel', async () => {
    const updateManagedSshEndpoint = vi.fn(async input => ({
      endpoint: {
        endpointId: input.endpointId,
        kind: 'remote_worker' as const,
        displayName: input.displayName ?? input.host,
        createdAt: '2026-04-12T00:00:00.000Z',
        updatedAt: '2026-04-13T00:00:00.000Z',
        access: {
          kind: 'managed_ssh' as const,
          managedSsh: {
            host: input.host,
            port: input.port ?? null,
            username: input.username ?? null,
            remotePort: input.remotePort,
            remotePlatform: input.remotePlatform ?? 'auto',
          },
        },
        remote: null,
      },
    }))
    const prepareEndpoint = vi.fn(async () => {
      throw new Error('replacement tunnel remains observable as failed health')
    })
    const { controlSurface } = createSubject({ updateManagedSshEndpoint, prepareEndpoint })
    const payload = {
      endpointId: 'managed-1',
      displayName: 'Updated SSH Box',
      host: 'updated.example.com',
      port: 2222,
      username: 'builder',
      remotePort: 39292,
      remotePlatform: 'auto',
    }

    const result = await controlSurface.invoke(ctx, {
      kind: 'command',
      id: 'endpoint.updateManagedSsh',
      payload,
    })

    expect(result.ok).toBe(true)
    expect(updateManagedSshEndpoint).toHaveBeenCalledWith(payload)
    expect(prepareEndpoint).toHaveBeenCalledWith({ endpointId: 'managed-1', reason: 'reconnect' })
  })
})
