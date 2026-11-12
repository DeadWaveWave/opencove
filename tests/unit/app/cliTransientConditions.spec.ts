// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { invoke } from '../../../src/app/cli/core/transport'
import { errorRetryable } from '../../../src/app/cli/core/errorPresentation'
import { fixture, snapshot } from './cliAgentWait.helpers'
import { CliError } from '../../../src/app/cli/core/errors'

afterEach(() => vi.useRealTimers())
it.each(['query', 'command'])('only labels a timed-out read as transient: %s', async kind => {
  vi.useFakeTimers()
  const fetch = vi.fn(
    async (_url: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => reject(new DOMException('Aborted', 'AbortError')),
          { once: true },
        )
      }),
  )
  const pending = invoke(
    { endpoint: 'http://fixture', token: 'test' },
    { kind, id: kind === 'query' ? 'system.ping' : 'node.create', payload: null },
    { timeoutMs: 10, fetch: fetch as typeof globalThis.fetch },
  ).catch(error => error)
  await vi.advanceTimersByTimeAsync(10)
  const error = await pending
  expect(error).toBeInstanceOf(CliError)
  expect(error.code).toBe('transport.timeout')
  expect(error.details?.reason).toBe(kind === 'query' ? 'read_timeout' : undefined)
  expect(errorRetryable(error, true)).toBe(kind === 'query')
})
it('labels an expired observation budget and can complete the unchanged wait later', async () => {
  vi.useFakeTimers()
  const f = fixture()
  const pending = f.wait().catch(error => error)
  await vi.advanceTimersByTimeAsync(1000)
  const error = await pending
  expect(error).toBeInstanceOf(CliError)
  expect(error).toMatchObject({ code: 'agent.wait_timeout', details: { reason: 'wait_timeout' } })
  expect(errorRetryable(error, true)).toBe(true)
  f.states[0] = snapshot('a', 'idle')
  expect((await f.wait()).agents[0].state).toBe('idle')
  expect(f.streams.every(stream => stream.cancelled)).toBe(true)
})
