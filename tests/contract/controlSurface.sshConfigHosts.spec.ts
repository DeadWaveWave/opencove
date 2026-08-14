import { describe, expect, it, vi } from 'vitest'
import { createControlSurface } from '../../src/app/main/controlSurface/controlSurface'
import { registerTopologyHandlers } from '../../src/app/main/controlSurface/handlers/topologyHandlers'
import type { ControlSurfaceContext } from '../../src/app/main/controlSurface/types'
import type { EndpointHealthService } from '../../src/app/main/controlSurface/topology/endpointHealthService'
import type { WorkerTopologyStore } from '../../src/app/main/controlSurface/topology/topologyStore'

const ctx: ControlSurfaceContext = {
  now: () => new Date('2026-08-14T00:00:00.000Z'),
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

describe('endpoint.sshConfigHosts', () => {
  it('is a read-only Query and does not call the topology owner', async () => {
    const readSshConfigHosts = vi.fn(async () => [
      { alias: 'build', hostName: '10.0.0.8', user: 'deploy', port: 2202 },
    ])
    const topology = new Proxy(
      {},
      {
        get: (_target, property) =>
          vi.fn(() => Promise.reject(new Error(`unexpected ${String(property)}`))),
      },
    ) as WorkerTopologyStore
    const controlSurface = createControlSurface()
    registerTopologyHandlers(controlSurface, {
      topology,
      approvedWorkspaces: {} as never,
      endpointHealth: {} as EndpointHealthService,
      readSshConfigHosts,
    })

    const result = await controlSurface.invoke(ctx, {
      kind: 'query',
      id: 'endpoint.sshConfigHosts',
      payload: null,
    })

    expect(result).toMatchObject({
      ok: true,
      value: [{ alias: 'build', hostName: '10.0.0.8', user: 'deploy', port: 2202 }],
    })
    expect(readSshConfigHosts).toHaveBeenCalledOnce()
  })

  it('rejects payload data at the runtime boundary', async () => {
    const controlSurface = createControlSurface()
    registerTopologyHandlers(controlSurface, {
      topology: {} as WorkerTopologyStore,
      approvedWorkspaces: {} as never,
      endpointHealth: {} as EndpointHealthService,
      readSshConfigHosts: vi.fn(async () => []),
    })

    const result = await controlSurface.invoke(ctx, {
      kind: 'query',
      id: 'endpoint.sshConfigHosts',
      payload: { path: '/tmp/other-user-config' },
    })

    expect(result).toMatchObject({ ok: false, error: { code: 'common.invalid_input' } })
  })
})
