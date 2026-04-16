import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRemotePersistenceStore } from '../../../src/app/main/controlSurface/remote/remotePersistenceStore'

describe('remote persistence store', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('re-resolves the worker endpoint for each request', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        text: async () =>
          JSON.stringify({
            __opencoveControlEnvelope: true,
            ok: true,
            value: { revision: 1, state: { source: 'first' } },
          }),
        status: 200,
      })
      .mockResolvedValueOnce({
        text: async () =>
          JSON.stringify({
            __opencoveControlEnvelope: true,
            ok: true,
            value: { revision: 2, state: { source: 'second' } },
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

    await expect(store.readAppState()).resolves.toEqual({ source: 'first' })
    await expect(store.readAppState()).resolves.toEqual({ source: 'second' })

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
