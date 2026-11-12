// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { fixture, snapshot } from './cliAgentWait.helpers'
import { waitForAgents } from '../../../src/app/cli/core/agentWait'
import { CliError } from '../../../src/app/cli/core/errors'

it('reconciles a live archive miss before a queued completion and captures durability from the reread', async () => {
  const f = fixture([snapshot('a', 'idle')]),
    original = f.query.getMockImplementation()!
  let histories = 0,
    lists = 0
  f.query.mockImplementation(async (id, payload) => {
    if (id === 'agent.list') {
      return { epoch: 'epoch', seq: ++lists < 3 ? 5 : 8, agents: f.states, turnArchive: true }
    }
    if (id === 'agent.finalMessage') {
      expect(payload).toEqual({ nodeId: 'a', turnId: 'turn' })
      if (++histories === 1) {
        throw new CliError('agent.final_message_unavailable', 1, 'miss', undefined, {
          reason: 'turn_not_found',
        })
      }
      return {
        nodeId: 'a',
        sessionId: 'original',
        turnId: 'turn',
        outcome: 'failed',
        persisted: true,
      }
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
  void pending.then(() => {
    settled = true
  })
  await vi.waitFor(() => expect(f.streams).toHaveLength(1))
  f.streams[0].send(f.event('unrelated', 'working', false, 6))
  f.streams[0].send(f.event('unrelated', 'working', false, 7))
  await new Promise(resolve => setImmediate(resolve))
  expect(settled).toBe(false)
  f.streams[0].send(f.event('a', 'idle', true, 8))
  expect(await pending).toMatchObject({ sessionId: 'original', outcome: 'failed', persisted: true })
  expect(histories).toBe(2)
})

it('accepts an archived metadata-only end without a live session, without fabricating readiness', async () => {
  const query = vi.fn(async (id: string) => {
    if (id === 'agent.list') {
      return { epoch: 'e', seq: 0, agents: [], turnArchive: true }
    }
    if (id === 'agent.get') {
      return null
    }
    throw new CliError('agent.final_message_unavailable', 1, 'no text', undefined, {
      reason: 'provider_sent_no_message',
      nodeId: 'a',
      sessionId: 'original',
      turnId: 'turn',
      outcome: 'unknown',
      endedAt: 10,
      persisted: true,
    })
  })
  const result = await waitForAgents({
    nodeIds: ['a'],
    turnId: 'turn',
    any: false,
    timeoutMs: 1000,
    query,
    fetch: vi.fn() as never,
    connection: { endpoint: 'http://fake', token: 't' },
  })
  expect(result).toEqual({
    nodeId: 'a',
    sessionId: 'original',
    turnId: 'turn',
    outcome: 'unknown',
    endedAt: 10,
    persisted: true,
    state: 'unknown',
  })
})

it('keeps mirrored latest remote ends usable while older remote history stays unavailable', async () => {
  const state = {
    ...snapshot('a', 'idle'),
    lastEndedTurn: { id: 'turn', outcome: 'completed' as const, endedAt: 5 },
  }
  const query = vi.fn(async (id: string) => {
    if (id === 'agent.list') {
      return { epoch: 'e', seq: 0, agents: [state], turnArchive: true }
    }
    if (id === 'agent.get') {
      return state
    }
    throw new CliError('agent.final_message_unavailable', 1, 'remote', undefined, {
      reason: 'remote_history_unavailable',
    })
  })
  const options = {
    nodeIds: ['a'],
    any: false,
    timeoutMs: 1000,
    query,
    fetch: vi.fn() as never,
    connection: { endpoint: 'http://fake', token: 't' },
  }
  expect(await waitForAgents({ ...options, turnId: 'turn' })).toMatchObject({
    outcome: 'completed',
    persisted: false,
    memoryOnlyReason: 'remote',
  })
  await expect(waitForAgents({ ...options, turnId: 'older' })).rejects.toMatchObject({
    code: 'agent.wait_turn_unavailable',
    details: expect.objectContaining({ reason: 'remote_history_unavailable' }),
  })
})
