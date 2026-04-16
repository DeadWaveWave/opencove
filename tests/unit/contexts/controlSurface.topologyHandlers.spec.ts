import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import type { ControlSurfaceContext } from '../../../src/app/main/controlSurface/types'
import { registerTopologyHandlers } from '../../../src/app/main/controlSurface/handlers/topologyHandlers'
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

function createSubject(): ReturnType<typeof createControlSurface> {
  const topology: WorkerTopologyStore = {
    listEndpoints: async () => ({ endpoints: [] }),
    registerEndpoint: async () => {
      throw new Error('not used')
    },
    removeEndpoint: async () => undefined,
    resolveRemoteEndpointConnection: async endpointId =>
      endpointId === 'remote' ? { hostname: 'example.com', port: 1234, token: 'token' } : null,
    listMounts: async () => ({ projectId: 'project', mounts: [] }),
    createMount: async () => {
      throw new Error('not used')
    },
    removeMount: async () => undefined,
    promoteMount: async () => undefined,
    resolveMountTarget: async () => null,
  }

  const controlSurface = createControlSurface()
  registerTopologyHandlers(controlSurface, {
    topology,
    approvedWorkspaces: {
      registerRoot: async () => undefined,
      isPathApproved: async () => true,
    },
  })

  return controlSurface
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

    const controlSurface = createSubject()

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

    const controlSurface = createSubject()

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

    const controlSurface = createSubject()

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
})
