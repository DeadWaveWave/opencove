import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { invokeBrowserControlSurface } from '../../../src/app/renderer/browser/browserControlSurface'

type Deferred = { resolve: (value: unknown) => void; body: string }

function envelope(value: unknown): string {
  return JSON.stringify({ __opencoveControlEnvelope: true, ok: true, value })
}

describe('browser control surface in-flight queries', () => {
  let pending: Deferred[]

  beforeEach(() => {
    pending = []
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: { body: string }) => {
        return new Promise(resolve => {
          pending.push({
            body: init.body,
            resolve: value =>
              resolve({ status: 200, text: async () => envelope(value) } as unknown as Response),
          })
        })
      }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const flush = async () => {
    await new Promise(resolve => setTimeout(resolve, 0))
  }

  it('shares one request between identical concurrent queries and gives each caller its own copy', async () => {
    const request = { kind: 'query' as const, id: 'session.get', payload: { sessionId: 's1' } }
    const first = invokeBrowserControlSurface<{ items: number[] }>(request)
    const second = invokeBrowserControlSurface<{ items: number[] }>(request)

    expect(fetch).toHaveBeenCalledTimes(1)
    pending[0]?.resolve({ items: [1] })

    const [a, b] = await Promise.all([first, second])
    expect(a).toEqual({ items: [1] })
    expect(b).toEqual({ items: [1] })
    expect(a).not.toBe(b)
  })

  it('does not share queries with different payloads', async () => {
    void invokeBrowserControlSurface({
      kind: 'query',
      id: 'session.get',
      payload: { sessionId: 'a' },
    })
    void invokeBrowserControlSurface({
      kind: 'query',
      id: 'session.get',
      payload: { sessionId: 'b' },
    })
    expect(fetch).toHaveBeenCalledTimes(2)
    for (const entry of pending) {
      entry.resolve(null)
    }
    await flush()
  })

  it('never shares commands', async () => {
    const command = { kind: 'command' as const, id: 'session.prepareOrRevive', payload: { n: 1 } }
    void invokeBrowserControlSurface(command)
    void invokeBrowserControlSurface(command)
    expect(fetch).toHaveBeenCalledTimes(2)
    for (const entry of pending) {
      entry.resolve(null)
    }
    await flush()
  })

  it('starts a fresh query after a command instead of joining a request from before it', async () => {
    const query = { kind: 'query' as const, id: 'session.get', payload: { sessionId: 's1' } }
    const before = invokeBrowserControlSurface(query)
    void invokeBrowserControlSurface({
      kind: 'command',
      id: 'session.kill',
      payload: { sessionId: 's1' },
    })
    const after = invokeBrowserControlSurface(query)

    expect(fetch).toHaveBeenCalledTimes(3)
    pending[0]?.resolve('old')
    pending[1]?.resolve(null)
    pending[2]?.resolve('new')
    await expect(before).resolves.toBe('old')
    await expect(after).resolves.toBe('new')
  })

  it('sends a new request once the shared one has settled', async () => {
    const request = { kind: 'query' as const, id: 'system.ping', payload: null }
    const first = invokeBrowserControlSurface(request)
    pending[0]?.resolve('pong')
    await first

    void invokeBrowserControlSurface(request)
    expect(fetch).toHaveBeenCalledTimes(2)
    pending[1]?.resolve('pong')
    await flush()
  })
})
