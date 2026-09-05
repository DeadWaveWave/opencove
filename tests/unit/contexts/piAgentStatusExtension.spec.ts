// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runInNewContext } from 'node:vm'
import { piAgentStatusExtensionSource } from '../../../src/contexts/agent/infrastructure/providers/pi/PiAgentStatusExtension'

function harness(envOverrides: Record<string, string | undefined> = {}) {
  const requests: {
    body: Record<string, unknown>
    finish: () => void
    destroy: ReturnType<typeof vi.fn>
  }[] = []
  const handlers = new Map<string, (event: Record<string, unknown>, ctx: unknown) => void>()
  let fileExists = false
  let idle = true
  let sessionId = 'a'
  const env = {
    OPENCOVE_PI_HOOK_ENDPOINT: 'http://127.0.0.1:1234/hooks/pi',
    OPENCOVE_PI_HOOK_TOKEN: 'token',
    ...envOverrides,
  }
  const context = {
    process: { pid: 123, env },
    URL,
    Symbol,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    stat: vi.fn(async () => {
      if (!fileExists) {
        throw new Error('ENOENT')
      }
      return { isFile: () => true, size: 100 }
    }),
    request: vi.fn((_url, _options, onResponse) => {
      const listeners = new Map<string, () => void>()
      const req = {
        on: (name: string, fn: () => void) => {
          listeners.set(name, fn)
          return req
        },
        end: (body: string) => {
          requests.push({
            body: JSON.parse(body),
            destroy: req.destroy,
            finish: () =>
              onResponse({
                resume: () => undefined,
                on: (name: string, fn: () => void) => {
                  if (name === 'end') {
                    fn()
                  }
                },
              }),
          })
        },
        destroy: vi.fn(() => {
          listeners.get('error')?.()
        }),
      }
      return req
    }),
  }
  const code = piAgentStatusExtensionSource
    .replace(/^import .*$/gm, '')
    .replace('export default', 'globalThis.factory =')
  const sandbox = runInNewContext(code + '; globalThis', context)
  const load = () => sandbox.factory({ on: (name: string, handler) => handlers.set(name, handler) })
  const ctx = {
    isIdle: () => idle,
    hasPendingMessages: () => false,
    sessionManager: {
      getSessionId: () => sessionId,
      getSessionFile: () => `/sessions/${sessionId}.jsonl`,
    },
  }
  const emit = (event: string, extra = {}) => handlers.get(event)?.(extra, ctx)
  load()
  return {
    requests,
    context,
    load,
    emit,
    setIdle: (value: boolean) => {
      idle = value
    },
    setFile: (value: boolean) => {
      fileExists = value
    },
    setSession: (value: string) => {
      sessionId = value
    },
  }
}

async function flush() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}
afterEach(() => {
  vi.useRealTimers()
})

describe('launch-scoped Pi status extension', () => {
  it('does nothing without valid loopback credentials, in nested processes, or before session_start', async () => {
    vi.useFakeTimers()
    for (const env of [
      { OPENCOVE_PI_HOOK_TOKEN: undefined },
      { OPENCOVE_PI_HOOK_ENDPOINT: 'https://outside.example/hooks/pi' },
      { OPENCOVE_PI_STATUS_OWNER_PID: '456' },
    ]) {
      const h = harness(env)
      h.emit('session_start')
      expect(h.requests).toEqual([])
    }
    expect(vi.getTimerCount()).toBe(0)
    expect(harness().requests).toEqual([])
  })

  it('coalesces into one complete latest snapshot and does not block event handlers on HTTP', async () => {
    vi.useFakeTimers()
    const h = harness()
    expect(h.emit('session_start')).toBeUndefined()
    await flush()
    expect(h.requests[0].body).toMatchObject({ state: 'standby', persistence: 'allocated' })
    h.setFile(true)
    h.setIdle(false)
    h.emit('agent_start')
    h.emit('ui_prompt_start')
    await flush()
    expect(h.requests).toHaveLength(1)
    h.requests[0].finish()
    await flush()
    expect(h.requests).toHaveLength(2)
    expect(h.requests[1].body).toMatchObject({
      sessionId: 'a',
      sessionFile: '/sessions/a.jsonl',
      persistence: 'resumable',
      state: 'waiting',
    })
    h.emit('session_shutdown', { reason: 'quit' })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('never treats low-level end or session shutdown as completion while continuation remains', async () => {
    vi.useFakeTimers()
    const h = harness()
    h.emit('session_start')
    await flush()
    h.requests[0].finish()
    h.setIdle(false)
    h.emit('agent_start')
    await flush()
    h.requests[1].finish()
    h.emit('agent_end')
    await vi.advanceTimersByTimeAsync(0)
    expect(h.requests).toHaveLength(2)
    h.setIdle(true)
    h.emit('agent_settled')
    await flush()
    expect(h.requests[2].body.state).toBe('standby')
    h.emit('session_shutdown', { reason: 'reload' })
    expect(h.requests).toHaveLength(3)
    expect(h.requests[2].destroy).toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('survives reload/new with monotonic sequences and rejects old-instance callbacks', async () => {
    vi.useFakeTimers()
    const h = harness()
    h.emit('session_start')
    await flush()
    const first = h.requests[0].body
    h.emit('session_shutdown', { reason: 'reload' })
    h.load()
    h.emit('session_start', { reason: 'reload' })
    await flush()
    expect(h.requests[1].body.sequence).toBeGreaterThan(first.sequence as number)
    expect(h.requests[1].body.conversationRevision).toBe(1)
    h.emit('session_shutdown', { reason: 'new' })
    h.setSession('b')
    h.load()
    h.emit('session_start', { reason: 'new' })
    await flush()
    expect(h.requests[2].body).toMatchObject({ conversationRevision: 2, sessionId: 'b' })
    h.requests[0].finish()
    await flush()
    expect(h.requests).toHaveLength(3)
    h.emit('session_shutdown')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('bounds hung requests to one second and renews only working leases', async () => {
    vi.useFakeTimers()
    const h = harness()
    h.emit('session_start')
    await flush()
    h.setIdle(false)
    h.emit('agent_start')
    await vi.advanceTimersByTimeAsync(1000)
    expect(h.requests[0].destroy).toHaveBeenCalled()
    expect(h.requests[1].body.state).toBe('working')
    h.requests[1].finish()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(h.requests.at(-1)!.body.state).toBe('working')
    h.emit('ui_prompt_start')
    await flush()
    h.requests.at(-1)!.finish()
    await flush()
    h.requests.at(-1)!.finish()
    await flush()
    const count = h.requests.length
    await vi.advanceTimersByTimeAsync(60_000)
    expect(h.requests).toHaveLength(count)
    h.emit('session_shutdown')
    expect(vi.getTimerCount()).toBe(0)
  })
})
