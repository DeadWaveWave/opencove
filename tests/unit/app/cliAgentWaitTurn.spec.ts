// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { waitForAgents } from '../../../src/app/cli/core/agentWait'
import { CliError } from '../../../src/app/cli/core/errors'
import type { AgentRunSnapshot } from '../../../src/shared/contracts/dto/agentRunState'
import { fixture, snapshot } from './cliAgentWait.helpers'

const active = { id: 'turn-a', startedAt: 2, start: 'observed' as const }
const ended = { id: active.id, outcome: 'failed' as const, endedAt: 3 }
function turnFixture(state: AgentRunSnapshot = { ...snapshot(), turn: active }) {
  const f = fixture([state])
  const wait = () =>
    waitForAgents({
      nodeIds: ['a'],
      turnId: active.id,
      any: false,
      timeoutMs: 1000,
      connection: { endpoint: 'http://fake', token: 'secret' },
      fetch: f.fetch as typeof fetch,
      query: f.query,
    })
  return { ...f, wait }
}
afterEach(() => vi.useRealTimers())
it('waits for A via its ended event even when the event already starts B', async () => {
  const f = turnFixture(),
    pending = f.wait()
  await vi.waitFor(() => expect(f.streams).toHaveLength(1))
  const event = f.event('a', 'working', true)
  event.endedTurn = active
  event.snapshot.turn = { ...active, id: 'turn-b' }
  f.streams[0].send(event)
  expect(await pending).toMatchObject({
    nodeId: 'a',
    sessionId: 'session-a',
    turnId: active.id,
    outcome: 'failed',
    state: 'working',
  })
  expect(f.streams[0].cancelled).toBe(true)
})
it('accepts A from the snapshot while B is already active', async () => {
  const f = turnFixture({ ...snapshot(), turn: { ...active, id: 'turn-b' }, lastEndedTurn: ended })
  expect(await f.wait()).toEqual({
    persisted: false,
    memoryOnlyReason: 'unavailable',
    nodeId: 'a',
    sessionId: 'session-a',
    turnId: active.id,
    outcome: 'failed',
    endedAt: 3,
    state: 'working',
  })
  expect(f.streams).toHaveLength(0)
})
it.each(['completed', 'failed', 'aborted', 'unknown'] as const)(
  'accepts already ended %s independently of optional identifier IO',
  async outcome => {
    const f = turnFixture({ ...snapshot('a', 'idle'), lastEndedTurn: { ...ended, outcome } })
    expect(await f.wait()).toMatchObject({ turnId: active.id, outcome, state: 'idle' })
    expect(
      f.query.mock.calls
        .filter(([id]) => id === 'agent.finalMessage')
        .map(([, payload]) => payload),
    ).toEqual([{ nodeId: 'a', turnId: active.id }])
  },
)
it.each([false, true])(
  'uses history for an older end (no message=%s), excluding content',
  async noMessage => {
    const f = turnFixture({
      ...snapshot(),
      turn: { ...active, id: 'newest' },
      lastEndedTurn: { ...ended, id: 'newer' },
    })
    const original = f.query.getMockImplementation()!
    f.query.mockImplementation(async (id, payload) => {
      if (id !== 'agent.finalMessage') {
        return original(id, payload)
      }
      expect(payload).toEqual({ sessionId: 'session-a', turnId: active.id })
      if (noMessage) {
        throw new CliError('agent.final_message_unavailable', 1, 'Unavailable', undefined, {
          reason: 'provider_sent_no_message',
          outcome: 'aborted',
          endedAt: 4,
        })
      }
      return {
        nodeId: 'a',
        sessionId: 'session-a',
        turnId: active.id,
        outcome: 'aborted',
        message: 'private',
        promptId: 'private-prompt',
      }
    })
    const result = await f.wait()
    expect(result).toMatchObject({ turnId: active.id, outcome: 'aborted', state: 'working' })
    expect(JSON.stringify(result)).not.toContain('private')
  },
)
it.each(['turn_not_found', 'no_ended_turn'])(
  'fails with eviction/restart guidance when history says %s',
  async reason => {
    const f = turnFixture({ ...snapshot(), turn: null })
    const original = f.query.getMockImplementation()!
    f.query.mockImplementation(async (id, payload) => {
      if (id !== 'agent.finalMessage') {
        return original(id, payload)
      }
      throw new CliError('agent.final_message_unavailable', 1, 'Unavailable', undefined, { reason })
    })
    await expect(f.wait()).rejects.toMatchObject({
      exitCode: 1,
      code: 'agent.wait_turn_unavailable',
      hint: expect.stringContaining('opencove agent get --node a'),
      details: { reason, nodeId: 'a', sessionId: 'session-a', turnId: active.id },
    })
  },
)
it.each(['permission', 'question'] as const)(
  'times out with 124 and lastKnown while A waits for %s',
  async blockedReason => {
    vi.useFakeTimers()
    const f = turnFixture({ ...snapshot('a', 'waiting'), blockedReason, turn: active })
    const pending = f.wait()
    const assertion = expect(pending).rejects.toMatchObject({
      exitCode: 124,
      details: {
        lastKnown: {
          agents: [expect.objectContaining({ turn: active, state: 'waiting', blockedReason })],
        },
      },
    })
    await vi.advanceTimersByTimeAsync(1000)
    await assertion
    expect(f.query.mock.calls.some(([id]) => id === 'agent.finalMessage')).toBe(false)
    expect(f.streams.every(s => s.cancelled)).toBe(true)
  },
)
it('supports an older Worker with no lastEndedTurn through exact ended events', async () => {
  const legacy = { ...snapshot(), turn: active }
  delete (legacy as Partial<AgentRunSnapshot>).lastEndedTurn
  const f = turnFixture(legacy),
    pending = f.wait()
  await vi.waitFor(() => expect(f.streams).toHaveLength(1))
  const event = f.event('a', 'idle', true)
  event.endedTurn = active
  delete (event.snapshot as Partial<AgentRunSnapshot>).lastEndedTurn
  f.streams[0].send(event)
  expect(await pending).toMatchObject({ turnId: active.id, outcome: 'failed' })
})
it('rechecks history after a nonmatching newer completion', async () => {
  const f = turnFixture(),
    pending = f.wait()
  const original = f.query.getMockImplementation()!
  f.query.mockImplementation(async (id, payload) =>
    id === 'agent.finalMessage'
      ? { sessionId: 'session-a', turnId: active.id, outcome: 'completed' }
      : original(id, payload),
  )
  await vi.waitFor(() => expect(f.streams).toHaveLength(1))
  f.streams[0].send(f.event('a', 'idle', true))
  expect(await pending).toMatchObject({ turnId: active.id, outcome: 'completed' })
})
it('rechecks a replaced incarnation after resync and refuses unknown history', async () => {
  const f = turnFixture(),
    pending = f.wait()
  const assertion = expect(pending).rejects.toMatchObject({
    exitCode: 1,
    code: 'agent.wait_turn_unavailable',
  })
  await vi.waitFor(() => expect(f.streams).toHaveLength(1))
  f.states[0] = { ...snapshot(), sessionId: 'replacement', turn: { ...active, id: 'other' } }
  const original = f.query.getMockImplementation()!
  f.query.mockImplementation(async (id, payload) => {
    if (id !== 'agent.finalMessage') {
      return original(id, payload)
    }
    throw new CliError('agent.final_message_unavailable', 1, 'Unavailable', undefined, {
      reason: 'turn_not_found',
    })
  })
  f.streams[0].send({ type: 'resync_required', epoch: 'epoch', seq: 5 })
  await assertion
  expect(f.streams.every(s => s.cancelled)).toBe(true)
})

it('uses history with an older Worker snapshot and a message-free end lacking outcome', async () => {
  const legacy = { ...snapshot('a', 'idle') }
  delete (legacy as Partial<AgentRunSnapshot>).lastEndedTurn
  const f = turnFixture(legacy)
  const original = f.query.getMockImplementation()!
  f.query.mockImplementation(async (id, payload) => {
    if (id !== 'agent.finalMessage') {
      return original(id, payload)
    }
    throw new CliError('agent.final_message_unavailable', 1, 'Unavailable', undefined, {
      reason: 'provider_sent_no_message',
    })
  })
  expect(await f.wait()).toEqual({
    persisted: false,
    memoryOnlyReason: 'unavailable',
    nodeId: 'a',
    sessionId: 'session-a',
    turnId: active.id,
    outcome: 'unknown',
    state: 'idle',
  })
})
it('resync recovers the selected end from history after newer turns finish', async () => {
  const f = turnFixture(),
    pending = f.wait()
  await vi.waitFor(() => expect(f.streams).toHaveLength(1))
  f.states[0] = { ...snapshot('a', 'idle'), lastEndedTurn: { ...ended, id: 'newer' } }
  const original = f.query.getMockImplementation()!
  f.query.mockImplementation(async (id, payload) =>
    id === 'agent.finalMessage'
      ? { sessionId: 'session-a', turnId: active.id, outcome: 'completed' }
      : original(id, payload),
  )
  f.streams[0].send({ type: 'resync_required', epoch: 'epoch', seq: 5 })
  expect(await pending).toMatchObject({ turnId: active.id, outcome: 'completed' })
  expect(f.streams.every(s => s.cancelled)).toBe(true)
})
it('preserves authorization failures from history', async () => {
  const f = turnFixture({ ...snapshot('a', 'idle') })
  const original = f.query.getMockImplementation()!
  f.query.mockImplementation(async (id, payload) => {
    if (id !== 'agent.finalMessage') {
      return original(id, payload)
    }
    throw new CliError('auth.forbidden', 1, 'Denied')
  })
  await expect(f.wait()).rejects.toMatchObject({ code: 'auth.forbidden' })
})
