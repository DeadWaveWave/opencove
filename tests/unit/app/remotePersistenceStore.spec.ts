import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRemotePersistenceStore } from '../../../src/app/main/controlSurface/remote/remotePersistenceStore'

function createMergeState(positionX: number, source: string) {
  return {
    formatVersion: 1,
    activeWorkspaceId: 'workspace-1',
    workspaces: [
      {
        id: 'workspace-1',
        name: 'Workspace',
        path: '/workspace',
        worktreesRoot: '/worktrees',
        nodes: [
          {
            id: 'node-1',
            title: 'Terminal',
            position: { x: positionX, y: 0 },
            width: 400,
            height: 300,
            kind: 'terminal',
            status: null,
            startedAt: null,
            endedAt: null,
            exitCode: null,
            lastError: null,
            scrollback: null,
            agent: null,
            task: null,
          },
        ],
        viewport: { x: 0, y: 0, zoom: 1 },
        isMinimapVisible: true,
        spaces: [],
        activeSpaceId: null,
        spaceArchiveRecords: [],
      },
    ],
    settings: { source },
  }
}

describe('remote persistence store', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('re-resolves the worker endpoint for each request', async () => {
    const firstState = {
      formatVersion: 1,
      activeWorkspaceId: null,
      workspaces: [],
      settings: { source: 'first' },
    }
    const secondState = {
      formatVersion: 1,
      activeWorkspaceId: null,
      workspaces: [],
      settings: { source: 'second' },
    }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        text: async () =>
          JSON.stringify({
            __opencoveControlEnvelope: true,
            ok: true,
            value: { revision: 1, state: firstState },
          }),
        status: 200,
      })
      .mockResolvedValueOnce({
        text: async () =>
          JSON.stringify({
            __opencoveControlEnvelope: true,
            ok: true,
            value: { revision: 2, state: secondState },
          }),
        status: 200,
      })

    vi.stubGlobal('fetch', fetchMock)

    const endpoints = [
      { hostname: '127.0.0.1', port: 4310, token: 'token-1' },
      { hostname: '127.0.0.1', port: 56277, token: 'token-2' },
    ]
    let index = 0
    const store = createRemotePersistenceStore(async () => endpoints[index++] ?? null)

    await expect(store.readAppState()).resolves.toEqual(firstState)
    await expect(store.readAppState()).resolves.toEqual(secondState)

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://127.0.0.1:4310/invoke',
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: 'Bearer token-1',
        }),
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://127.0.0.1:56277/invoke',
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: 'Bearer token-2',
        }),
      }),
    )
  })

  it('keeps a successful remote no-state read as null', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      text: async () =>
        JSON.stringify({
          __opencoveControlEnvelope: true,
          ok: true,
          value: { revision: 0, state: null },
        }),
      status: 200,
    })
    vi.stubGlobal('fetch', fetchMock)
    const store = createRemotePersistenceStore(async () => ({
      hostname: '127.0.0.1',
      port: 4310,
      token: 'token-1',
    }))

    await expect(store.readAppState()).resolves.toBeNull()
  })

  it('rejects a remote app-state transport failure as unavailable', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('simulated transport failure'))
    vi.stubGlobal('fetch', fetchMock)
    const store = createRemotePersistenceStore(async () => ({
      hostname: '127.0.0.1',
      port: 4310,
      token: 'token-1',
    }))

    await expect(store.readAppState()).rejects.toMatchObject({
      code: 'persistence.unavailable',
    })
  })

  it.each([
    ['a null response body', null],
    [
      'a success envelope without an ok discriminator',
      {
        __opencoveControlEnvelope: true,
        value: { revision: 0, state: null },
      },
    ],
    ['a success envelope without a value', { __opencoveControlEnvelope: true, ok: true }],
    ['a null success value', { __opencoveControlEnvelope: true, ok: true, value: null }],
    [
      'a value without revision',
      { __opencoveControlEnvelope: true, ok: true, value: { state: null } },
    ],
    [
      'a value without state',
      { __opencoveControlEnvelope: true, ok: true, value: { revision: 0 } },
    ],
    [
      'a negative revision',
      { __opencoveControlEnvelope: true, ok: true, value: { revision: -1, state: null } },
    ],
    [
      'a fractional revision',
      { __opencoveControlEnvelope: true, ok: true, value: { revision: 1.5, state: null } },
    ],
    [
      'an unsafe revision',
      {
        __opencoveControlEnvelope: true,
        ok: true,
        value: { revision: Number.MAX_SAFE_INTEGER + 1, state: null },
      },
    ],
    [
      'an invalid persisted state',
      { __opencoveControlEnvelope: true, ok: true, value: { revision: 0, state: {} } },
    ],
    [
      'a nested malformed persisted state',
      {
        __opencoveControlEnvelope: true,
        ok: true,
        value: {
          revision: 1,
          state: {
            formatVersion: 1,
            activeWorkspaceId: null,
            workspaces: [{ id: 'workspace-without-runtime-shape' }],
            settings: {},
          },
        },
      },
    ],
  ])('rejects %s as unavailable', async (_label, responseBody) => {
    const fetchMock = vi.fn().mockResolvedValue({
      text: async () => JSON.stringify(responseBody),
      status: 200,
    })
    vi.stubGlobal('fetch', fetchMock)
    const store = createRemotePersistenceStore(async () => ({
      hostname: '127.0.0.1',
      port: 4310,
      token: 'token-1',
    }))

    await expect(store.readAppState()).rejects.toMatchObject({
      code: 'persistence.unavailable',
    })
  })

  it('updates the last-known sync snapshot only after a remote read validates', async () => {
    const initialState = {
      formatVersion: 1,
      activeWorkspaceId: null,
      workspaces: [],
      settings: { source: 'initial' },
    }
    const nextState = {
      formatVersion: 1,
      activeWorkspaceId: null,
      workspaces: [],
      settings: { source: 'next' },
    }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        text: async () =>
          JSON.stringify({
            __opencoveControlEnvelope: true,
            ok: true,
            value: { revision: 7, state: initialState },
          }),
        status: 200,
      })
      .mockResolvedValueOnce({
        text: async () =>
          JSON.stringify({
            __opencoveControlEnvelope: true,
            ok: true,
            value: { revision: 9, state: {} },
          }),
        status: 200,
      })
      .mockResolvedValueOnce({
        text: async () =>
          JSON.stringify({
            __opencoveControlEnvelope: true,
            ok: true,
            value: { revision: 8 },
          }),
        status: 200,
      })
    vi.stubGlobal('fetch', fetchMock)
    const store = createRemotePersistenceStore(async () => ({
      hostname: '127.0.0.1',
      port: 4310,
      token: 'token-1',
    }))

    await expect(store.readAppState()).resolves.toEqual(initialState)
    await expect(store.readAppState()).rejects.toMatchObject({
      code: 'persistence.unavailable',
    })
    await expect(store.writeAppState(nextState)).resolves.toMatchObject({
      ok: true,
      revision: 8,
    })

    const writeRequest = JSON.parse(
      String((fetchMock.mock.calls[2]?.[1] as { body?: unknown } | undefined)?.body ?? ''),
    ) as { payload?: { baseRevision?: unknown } }
    expect(writeRequest.payload?.baseRevision).toBe(7)
  })

  it('uses the validated preflight state as the three-way merge base on first-write conflict', async () => {
    const initialState = createMergeState(0, 'initial')
    const remoteState = createMergeState(10, 'remote')
    const localState = createMergeState(0, 'local')
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        text: async () =>
          JSON.stringify({
            __opencoveControlEnvelope: true,
            ok: true,
            value: { revision: 1, state: initialState },
          }),
        status: 200,
      })
      .mockResolvedValueOnce({
        text: async () =>
          JSON.stringify({
            __opencoveControlEnvelope: true,
            ok: false,
            error: {
              code: 'persistence.invalid_state',
              debugMessage: 'revision conflict',
            },
          }),
        status: 409,
      })
      .mockResolvedValueOnce({
        text: async () =>
          JSON.stringify({
            __opencoveControlEnvelope: true,
            ok: true,
            value: { revision: 2, state: remoteState },
          }),
        status: 200,
      })
      .mockResolvedValueOnce({
        text: async () =>
          JSON.stringify({
            __opencoveControlEnvelope: true,
            ok: true,
            value: { revision: 3 },
          }),
        status: 200,
      })
    vi.stubGlobal('fetch', fetchMock)
    const store = createRemotePersistenceStore(async () => ({
      hostname: '127.0.0.1',
      port: 4310,
      token: 'token-1',
    }))

    await expect(store.writeAppState(localState)).resolves.toMatchObject({
      ok: true,
      revision: 3,
    })
    const retryRequest = JSON.parse(
      String((fetchMock.mock.calls[3]?.[1] as { body?: unknown } | undefined)?.body ?? ''),
    ) as {
      payload?: {
        state?: { workspaces?: Array<{ nodes?: Array<{ position?: { x?: number } }> }> }
      }
    }
    expect(retryRequest.payload?.state?.workspaces?.[0]?.nodes?.[0]?.position?.x).toBe(10)
  })

  it('fails a write closed when its required base snapshot is malformed', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      text: async () =>
        JSON.stringify({
          __opencoveControlEnvelope: true,
          ok: true,
          value: { revision: 7, state: {} },
        }),
      status: 200,
    })
    vi.stubGlobal('fetch', fetchMock)
    const store = createRemotePersistenceStore(async () => ({
      hostname: '127.0.0.1',
      port: 4310,
      token: 'token-1',
    }))

    await expect(
      store.writeAppState({
        formatVersion: 1,
        activeWorkspaceId: null,
        workspaces: [],
        settings: { source: 'local' },
      }),
    ).resolves.toMatchObject({ ok: false, reason: 'io' })
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('fails a conflict retry closed when the refreshed snapshot is malformed', async () => {
    const initialState = {
      formatVersion: 1,
      activeWorkspaceId: null,
      workspaces: [],
      settings: { source: 'initial' },
    }
    const localState = {
      formatVersion: 1,
      activeWorkspaceId: null,
      workspaces: [],
      settings: { source: 'local' },
    }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        text: async () =>
          JSON.stringify({
            __opencoveControlEnvelope: true,
            ok: true,
            value: { revision: 7, state: initialState },
          }),
        status: 200,
      })
      .mockResolvedValueOnce({
        text: async () =>
          JSON.stringify({
            __opencoveControlEnvelope: true,
            ok: false,
            error: {
              code: 'persistence.invalid_state',
              debugMessage: 'revision conflict',
            },
          }),
        status: 409,
      })
      .mockResolvedValueOnce({
        text: async () =>
          JSON.stringify({
            __opencoveControlEnvelope: true,
            ok: true,
            value: { revision: 8, state: {} },
          }),
        status: 200,
      })
    vi.stubGlobal('fetch', fetchMock)
    const store = createRemotePersistenceStore(async () => ({
      hostname: '127.0.0.1',
      port: 4310,
      token: 'token-1',
    }))

    await expect(store.readAppState()).resolves.toEqual(initialState)
    await expect(store.writeAppState(localState)).resolves.toMatchObject({
      ok: false,
      reason: 'io',
    })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('passes agent placeholder scrollback requests through to the worker', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        text: async () =>
          JSON.stringify({
            __opencoveControlEnvelope: true,
            ok: true,
            value: 'PLACEHOLDER_SCROLLBACK',
          }),
        status: 200,
      })
      .mockResolvedValueOnce({
        text: async () =>
          JSON.stringify({
            __opencoveControlEnvelope: true,
            ok: true,
            value: { ok: true, level: 'full', bytes: 19 },
          }),
        status: 200,
      })

    vi.stubGlobal('fetch', fetchMock)

    const store = createRemotePersistenceStore(async () => ({
      hostname: '127.0.0.1',
      port: 4310,
      token: 'token-1',
    }))

    await expect(store.readAgentNodePlaceholderScrollback('node-1')).resolves.toEqual(
      'PLACEHOLDER_SCROLLBACK',
    )
    await expect(
      store.writeAgentNodePlaceholderScrollback('node-1', 'PLACEHOLDER_SCROLLBACK'),
    ).resolves.toEqual({ ok: true, level: 'full', bytes: 19 })

    const firstRequest = JSON.parse(
      String((fetchMock.mock.calls[0]?.[1] as { body?: unknown } | undefined)?.body ?? ''),
    ) as { kind?: unknown; id?: unknown; payload?: unknown }
    expect(firstRequest).toEqual({
      kind: 'query',
      id: 'sync.readAgentNodePlaceholderScrollback',
      payload: { nodeId: 'node-1' },
    })

    const secondRequest = JSON.parse(
      String((fetchMock.mock.calls[1]?.[1] as { body?: unknown } | undefined)?.body ?? ''),
    ) as { kind?: unknown; id?: unknown; payload?: unknown }
    expect(secondRequest).toEqual({
      kind: 'command',
      id: 'sync.writeAgentNodePlaceholderScrollback',
      payload: { nodeId: 'node-1', scrollback: 'PLACEHOLDER_SCROLLBACK' },
    })
  })
})
