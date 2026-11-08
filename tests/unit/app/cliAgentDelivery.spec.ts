// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { run } from '../../../src/app/cli/core/run'
import type { CliIo } from '../../../src/app/cli/core/io'
import type { AgentDelivery } from '../../../src/shared/contracts/dto/agentDelivery'
afterEach(() => vi.useRealTimers())
const dto = (status: AgentDelivery['status']) => ({
  available: true,
  deliveryId: 'id',
  epoch: 'worker',
  incarnation: 'invocation',
  sessionId: 'target',
  nodeId: 'node',
  mode: 'steer',
  turnId: 'turn',
  status,
  evidenceWindow: 'open',
  createdAt: 1000,
})
function fixture(values: unknown[], self = false) {
  let out = '',
    err = '',
    calls = 0
  const fetch = vi.fn(async (_url, init) => {
    const request = JSON.parse(String(init.body))
    if (request.id === 'system.whoami') {
      return new Response(
        JSON.stringify({
          ok: true,
          value: {
            kind: 'session-grant',
            scopeTier: 'interact',
            sessionId: self ? 'target' : 'other',
          },
        }),
      )
    }
    expect(request.id).toBe('agent.delivery.get')
    const value = values[Math.min(calls++, values.length - 1)]
    return new Response(JSON.stringify({ ok: true, value }))
  })
  const io: CliIo = {
    stdout: {
      write: s => {
        out += s
      },
    },
    stderr: {
      write: s => {
        err += s
      },
    },
    env: { OPENCOVE_CONTROL_URL: 'http://fake', OPENCOVE_CONTROL_TOKEN: 'fake' },
    now: Date.now,
    fetch,
    readTextFile: vi.fn(),
    readStdinText: vi.fn(),
  }
  return { io, fetch, calls: () => calls, out: () => out, err: () => err }
}
it.each(['submitted', 'pending', 'dispatched', 'ambiguous', 'unknown', 'not_sent'] as const)(
  'delivery %s returns its evidence exit and DTO',
  async status => {
    const f = fixture([dto(status)])
    expect(await run(['agent', 'delivery', 'id'], f.io)).toBe(status === 'submitted' ? 0 : 1)
    expect(JSON.parse(f.out())).toMatchObject({ status })
  },
)
it('unavailable lookup is exit 1, never not_sent', async () => {
  const f = fixture([{ available: false, deliveryId: 'id', reason: 'unavailable' }])
  expect(await run(['agent', 'delivery', 'id'], f.io)).toBe(1)
  expect(JSON.parse(f.out())).toMatchObject({ available: false })
})
it('wait queries fresh status rather than reusing a pending response', async () => {
  vi.useFakeTimers()
  const f = fixture([dto('dispatched'), dto('submitted')])
  const p = run(['agent', 'delivery', 'id', '--wait', '--timeout', '2s'], f.io)
  await vi.advanceTimersByTimeAsync(250)
  expect(await p).toBe(0)
  expect(f.calls()).toBe(2)
})
it('self-wait returns current status immediately', async () => {
  const f = fixture([dto('dispatched')], true)
  expect(await run(['agent', 'delivery', 'id', '--wait'], f.io)).toBe(1)
  expect(f.calls()).toBe(1)
  expect(JSON.parse(f.out())).toMatchObject({ status: 'dispatched' })
})
it('wait deadline returns 124 with the last snapshot', async () => {
  vi.useFakeTimers()
  const f = fixture([dto('dispatched')])
  const p = run(['agent', 'delivery', 'id', '--wait', '--timeout', '500ms'], f.io)
  await vi.advanceTimersByTimeAsync(500)
  expect(await p).toBe(124)
  expect(JSON.parse(f.err()).error.details.lastKnown).toMatchObject({ status: 'dispatched' })
})
it('delivery help distinguishes evidence collection from the agent work lifecycle', async () => {
  const f = fixture([])
  expect(await run(['agent', 'delivery', '--help'], f.io)).toBe(0)
  expect(f.out()).toContain('evidenceWindow (open/closed)')
  expect(f.out()).toContain('not the agent’s work')
  expect(f.out()).toMatchSnapshot()
})
