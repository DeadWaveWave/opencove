// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { fixture, snapshot } from './cliAgentWait.helpers'
import { waitForAgents } from '../../../src/app/cli/core/agentWait'
import { CliError } from '../../../src/app/cli/core/errors'
import { registryWaitFixture } from './agentWaitRegistry.helpers'

it('consumes a queued completion after its idle event when history has already evicted it', async () => {
  const f = registryWaitFixture(true)
  f.observe('working', 'start')
  f.onSubscribe(() => {
    f.observe('idle', 'completed')
    for (let i = 0; i < 8; i++) {
      f.observe('working', 'start')
      f.observe('idle', 'completed')
    }
  })
  try {
    expect(await f.wait('t1')).toMatchObject({ turnId: 't1', outcome: 'completed' })
    expect(f.events.some(event => event.endedTurn?.id === 't1')).toBe(true)
  } finally {
    f.registry.dispose()
  }
})
it.each(['retained', 'later', 'idle'] as const)(
  'finishes with unrelated churn: %s',
  async scenario => {
    const f = registryWaitFixture()
    f.observe('working', 'start')
    if (scenario === 'retained') {
      f.observe('idle', 'completed')
    }
    f.registry.register({
      sessionId: 'other',
      nodeId: 'other',
      incarnation: 'other',
      provider: 'codex',
    })
    let sequence = 0
    const original = f.query.getMockImplementation()!
    f.query.mockImplementation(async (id, payload) => {
      await new Promise(resolve => setTimeout(resolve, 2))
      f.registry.observe('other', {
        incarnation: 'other',
        source: 'codex_hook',
        observedAt: 1000 + sequence,
        sourceSequence: ++sequence,
        state: sequence % 2 ? 'working' : 'waiting',
      })
      return original(id, payload)
    })
    f.onSubscribe(() => f.observe('idle', 'completed'))
    try {
      const result = await f.wait(scenario === 'idle' ? undefined : 't1')
      expect(result).toMatchObject(
        scenario === 'idle'
          ? { agents: [{ state: 'idle' }] }
          : { turnId: 't1', outcome: 'completed' },
      )
      expect(f.query.mock.calls.length).toBeLessThan(10)
    } finally {
      f.registry.dispose()
    }
  },
)

it.each([false, true])(
  'reconciles provisional history through unrelated events (completion at fence=%s)',
  async completes => {
    const f = fixture([snapshot('a', 'idle')])
    let lists = 0
    const original = f.query.getMockImplementation()!
    f.query.mockImplementation(async (id, payload) => {
      if (id === 'agent.list') {
        return { epoch: 'epoch', seq: ++lists === 1 ? 5 : 8, agents: f.states }
      }
      if (id === 'agent.finalMessage') {
        throw new CliError('agent.final_message_unavailable', 1, 'Unavailable', undefined, {
          reason: 'turn_not_found',
        })
      }
      return original(id, payload)
    })
    const pending = waitForAgents({
      nodeIds: ['a'],
      turnId: 'turn',
      any: false,
      timeoutMs: 1000,
      query: f.query,
      fetch: f.fetch as typeof fetch,
      connection: { endpoint: 'http://fake', token: 't' },
    })
    let settled = false
    const result = pending.then(
      value => {
        settled = true
        return value
      },
      error => {
        settled = true
        throw error
      },
    )
    const assertion = completes
      ? expect(result).resolves.toMatchObject({ turnId: 'turn', outcome: 'failed' })
      : expect(result).rejects.toMatchObject({ code: 'agent.wait_turn_unavailable', exitCode: 1 })
    await vi.waitFor(() => expect(f.streams).toHaveLength(1))
    expect(f.streams[0].url.searchParams.has('nodeId')).toBe(false)
    f.streams[0].send(f.event('unrelated', 'working', false, 6))
    f.streams[0].send(f.event('unrelated', 'working', false, 7))
    await new Promise(resolve => setImmediate(resolve))
    expect(settled).toBe(false)
    f.streams[0].send(f.event(completes ? 'a' : 'unrelated', 'idle', completes, 8))
    await assertion
    expect(f.streams[0].cancelled).toBe(true)
  },
)
