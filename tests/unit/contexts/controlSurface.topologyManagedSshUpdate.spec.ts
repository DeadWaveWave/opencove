import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { registerTopologyHandlers } from '../../../src/app/main/controlSurface/handlers/topologyHandlers'
import type { ControlSurfaceContext } from '../../../src/app/main/controlSurface/types'
import {
  createEndpointHealthService,
  type EndpointHealthService,
} from '../../../src/app/main/controlSurface/topology/endpointHealthService'
import type { ManagedSshEndpointRuntime } from '../../../src/app/main/controlSurface/topology/managedSshEndpointRuntime'
import {
  createWorkerTopologyStore,
  type WorkerTopologyStore,
} from '../../../src/app/main/controlSurface/topology/topologyStore'

const tempPaths: string[] = []

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
    getEndpointRemovalImpacts: async endpointIds =>
      new Map(endpointIds.map(endpointId => [endpointId, { mountIds: [], mountCount: 0 }])),
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
  afterEach(async () => {
    await Promise.all(tempPaths.splice(0).map(async path => await rm(path, { recursive: true })))
  })

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

  it('disposes the old tunnel before preparing the persisted replacement configuration', async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), 'opencove-control-update-order-'))
    tempPaths.push(userDataPath)
    const events: string[] = []
    const topology = createWorkerTopologyStore({
      userDataPath,
      disposeManagedSshEndpointRuntime: async access => {
        events.push(`dispose:${access.ssh.host}:${String(access.ssh.remotePort)}`)
      },
    })
    const registered = await topology.registerManagedSshEndpoint({
      host: 'old.example.com',
      remotePort: 41_000,
    })
    const prepare = vi.fn<ManagedSshEndpointRuntime['prepare']>(async access => {
      const durable = JSON.parse(
        await readFile(join(userDataPath, 'worker-topology.json'), 'utf8'),
      ) as { endpoints: Array<{ managedSsh?: { host?: string; remotePort?: number } }> }
      expect(durable.endpoints[0]?.managedSsh).toMatchObject({
        host: 'new.example.com',
        remotePort: 42_000,
      })
      events.push(`prepare:${access.ssh.host}:${String(access.ssh.remotePort)}`)
      return {
        connection: null,
        snapshot: {
          endpointId: access.endpointId,
          status: 'idle',
          localPort: null,
          lastError: null,
          stderrTail: '',
        },
        bootstrapRan: false,
      }
    })
    const managedRuntime: ManagedSshEndpointRuntime = {
      resolveConnection: async () => null,
      disposeEndpoint: async () => undefined,
      prepare,
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
    }
    const controlSurface = createControlSurface()
    registerTopologyHandlers(controlSurface, {
      topology,
      endpointHealth: createEndpointHealthService({ topology, managedRuntime }),
      approvedWorkspaces: {
        registerRoot: async () => undefined,
        isPathApproved: async () => true,
      },
    })

    const result = await controlSurface.invoke(ctx, {
      kind: 'command',
      id: 'endpoint.updateManagedSsh',
      payload: {
        endpointId: registered.endpoint.endpointId,
        host: 'new.example.com',
        remotePort: 42_000,
      },
    })

    expect(result.ok).toBe(true)
    expect(events).toEqual(['dispose:old.example.com:41000', 'prepare:new.example.com:42000'])
    expect(prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        endpointId: registered.endpoint.endpointId,
        ssh: expect.objectContaining({ host: 'new.example.com', remotePort: 42_000 }),
      }),
      { restartTunnel: true, allowBootstrap: true },
    )
  })
})
