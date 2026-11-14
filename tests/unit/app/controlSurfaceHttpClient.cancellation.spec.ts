// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { invokeControlSurface } from '../../../src/app/main/controlSurface/remote/controlSurfaceHttpClient'

const endpoint = { hostname: '127.0.0.1', port: 1, token: 'test' }
const request = { kind: 'query' as const, id: 'session.finalMessage', payload: { sessionId: 's' } }
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

it('propagates cancellation to fetch and rejects a response body completed after abort', async () => {
  vi.useFakeTimers()
  const controller = new AbortController()
  let transportSignal: AbortSignal | undefined
  let release!: () => void
  const fetch = vi.fn(async (_url, init) => {
    transportSignal = init.signal
    return {
      status: 200,
      text: () =>
        new Promise<string>(resolve => {
          release = () =>
            resolve(JSON.stringify({ __opencoveControlEnvelope: true, ok: true, value: {} }))
        }),
    }
  })
  vi.stubGlobal('fetch', fetch)
  const result = invokeControlSurface(endpoint, request, { signal: controller.signal }).catch(
    error => error,
  )
  await vi.advanceTimersByTimeAsync(0)
  controller.abort(new Error('client ended'))
  expect(transportSignal?.aborted).toBe(true)
  release()
  expect(await result).toBe(controller.signal.reason)
  expect(vi.getTimerCount()).toBe(0)
})

it('retains the default timeout and successful result for callers without a signal', async () => {
  vi.useFakeTimers()
  const envelope = { __opencoveControlEnvelope: true, ok: true, value: { message: 'answer' } }
  let signal!: AbortSignal
  let release!: () => void
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url, init) => {
      signal = init.signal
      return {
        status: 200,
        text: () =>
          new Promise<string>(resolve => {
            release = () => resolve(JSON.stringify(envelope))
          }),
      }
    }),
  )
  const result = invokeControlSurface(endpoint, request)
  await vi.advanceTimersByTimeAsync(14_999)
  expect(signal.aborted).toBe(false)
  release()
  expect(await result).toEqual({ httpStatus: 200, result: envelope })
  expect(vi.getTimerCount()).toBe(0)
})

it('does not let a caller signal cancel a forwarded mutation', async () => {
  const controller = new AbortController()
  controller.abort()
  const envelope = { __opencoveControlEnvelope: true, ok: true, value: {} }
  const fetch = vi.fn(async (_url, init) => {
    expect(init.signal.aborted).toBe(false)
    return { status: 200, text: async () => JSON.stringify(envelope) }
  })
  vi.stubGlobal('fetch', fetch)
  expect(
    await invokeControlSurface(
      endpoint,
      { kind: 'command', id: 'sync.writeState', payload: {} },
      { signal: controller.signal },
    ),
  ).toEqual({ httpStatus: 200, result: envelope })
  expect(fetch).toHaveBeenCalledOnce()
})
