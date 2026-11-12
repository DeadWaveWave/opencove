// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { AgentRunStateRegistry } from '../../../src/contexts/agent/application/AgentRunStateRegistry'
import { InMemoryAgentTurnArchive } from '../../support/agentTurnArchive/InMemoryAgentTurnArchive'
import { endedTurn } from '../../support/agentTurnArchive/agentTurnArchiveContract'
import { waitForAgents } from '../../../src/app/cli/core/agentWait'

function registry(archive = new InMemoryAgentTurnArchive({ now: () => 100 })) {
  let turn = 0
  return new AgentRunStateRegistry({
    epoch: 'e',
    now: () => 100,
    createTurnId: () => (++turn === 1 ? 'turn' : `turn${turn}`),
    schedule: () => () => {},
    archive,
    membership: () => 'member',
  })
}
function finish(r: AgentRunStateRegistry) {
  r.observe(
    's',
    {
      incarnation: 'i',
      source: 'claude_hook',
      sourceSequence: 1,
      observedAt: 1,
      emittedAtMs: 1,
      hookEventName: 'UserPromptSubmit',
      state: 'working',
      boundary: { kind: 'start', evidence: 'prompt_submit' },
    },
    { providerSessionId: 'p', promptId: 'prompt' },
  )
  r.observe(
    's',
    {
      incarnation: 'i',
      source: 'claude_hook',
      sourceSequence: 2,
      observedAt: 2,
      state: 'idle',
      hookEventName: 'Stop',
      boundary: { kind: 'end', outcome: 'completed' },
    },
    {
      providerSessionId: 'p',
      promptId: 'prompt',
      finalMessage: { message: 'reply', truncated: false },
    },
  )
}
it('stamps immutable launch ownership before publishing, rather than the mutable binding', () => {
  const archive = new InMemoryAgentTurnArchive({ now: () => 100 }),
    r = registry(archive)
  r.register({ sessionId: 's', incarnation: 'i', provider: 'claude-code', nodeId: 'original' })
  r.bind('s', { nodeId: 'replacement' })
  finish(r)
  expect(r.finalMessage({ sessionId: 's', turnId: 'turn' })).toMatchObject({
    nodeId: 'original',
    persisted: true,
    message: 'reply',
  })
  expect(() => r.finalMessage({ nodeId: 'replacement', turnId: 'turn' })).toThrow(
    expect.objectContaining({ details: expect.objectContaining({ reason: 'turn_not_found' }) }),
  )
  expect(archive.getExact({ nodeId: 'original', turnId: 'turn' })).toMatchObject({
    status: 'found',
  })
})
it('reads an exact original session and node after a simulated Worker restart', () => {
  const archive = new InMemoryAgentTurnArchive({ now: () => 100 }),
    old = registry(archive)
  old.register({ sessionId: 's', incarnation: 'i', provider: 'claude-code', nodeId: 'node' })
  finish(old)
  old.dispose()
  const fresh = registry(archive)
  expect(fresh.get({ nodeId: 'node' })).toBeNull()
  expect(fresh.finalMessage({ nodeId: 'node', turnId: 'turn' })).toMatchObject({
    sessionId: 's',
    message: 'reply',
    persisted: true,
  })
  expect(fresh.finalMessage({ sessionId: 's', turnId: 'turn' })).toMatchObject({
    nodeId: 'node',
    persisted: true,
  })
})
it('waits for an archived turn without a live run snapshot', async () => {
  const archive = new InMemoryAgentTurnArchive({ now: () => 100 })
  archive.append(
    endedTurn({ nodeId: 'node', turnId: 'turn', sessionId: 'original', outcome: 'failed' }),
  )
  const r = registry(archive)
  const query = vi.fn(async (id: string, input: unknown) =>
    id === 'agent.list'
      ? r.list()
      : id === 'agent.get'
        ? null
        : r.finalMessage(input as { nodeId: string; turnId: string }),
  )
  const result = await waitForAgents({
    nodeIds: ['node'],
    turnId: 'turn',
    any: false,
    timeoutMs: 1000,
    connection: { endpoint: 'http://fake', token: 't' },
    fetch: vi.fn() as never,
    query,
  })
  expect(result).toMatchObject({
    sessionId: 'original',
    outcome: 'failed',
    persisted: true,
    state: 'unknown',
  })
})

it('appends before completion callbacks and survives a reentrant start', () => {
  const archive = new InMemoryAgentTurnArchive({ now: () => 100 })
  const append = vi.spyOn(archive, 'append')
  const r = registry(archive)
  r.register({ sessionId: 's', incarnation: 'i', provider: 'claude-code', nodeId: 'node' })
  r.subscribe({ epoch: 'e', afterSeq: 0 }, { types: ['agent.turn_completed'] }, event => {
    expect(append).toHaveBeenCalledOnce()
    expect(r.finalMessage({ nodeId: 'node', turnId: 'turn' })).toMatchObject({
      message: 'reply',
      persisted: true,
    })
    expect(JSON.stringify(event)).not.toContain('reply')
    r.observe(
      's',
      {
        incarnation: 'i',
        source: 'claude_hook',
        sourceSequence: 3,
        observedAt: 3,
        emittedAtMs: 3,
        hookEventName: 'UserPromptSubmit',
        state: 'working',
        boundary: { kind: 'start', evidence: 'prompt_submit' },
      },
      { providerSessionId: 'p', promptId: 'next' },
    )
  })
  finish(r)
  expect(r.get({ nodeId: 'node' })?.turn?.id).toBe('turn2')
  expect(r.finalMessage({ nodeId: 'node', turnId: 'turn' })).toMatchObject({ message: 'reply' })
})

it.each(['unavailable', 'throw'] as const)(
  'keeps memory and publishes an end when archive %s fails',
  failure => {
    const archive = new InMemoryAgentTurnArchive({ now: () => 100 })
    vi.spyOn(archive, 'append').mockImplementation(() => {
      if (failure === 'throw') {
        throw new Error('storage failure')
      }
      return { status: 'memory_only', reason: 'unavailable' }
    })
    const r = registry(archive),
      events: unknown[] = []
    r.register({ sessionId: 's', incarnation: 'i', provider: 'claude-code', nodeId: 'node' })
    r.subscribe({ epoch: 'e', afterSeq: 0 }, { types: ['agent.turn_completed'] }, event =>
      events.push(event),
    )
    expect(() => finish(r)).not.toThrow()
    expect(events).toHaveLength(1)
    expect(r.finalMessage({ nodeId: 'node', turnId: 'turn' })).toMatchObject({
      persisted: false,
      memoryOnlyReason: failure === 'throw' ? 'write_failed' : 'unavailable',
      message: 'reply',
    })
  },
)

it('revokes both cached and archived history, including late ends from the removed owner', () => {
  const archive = new InMemoryAgentTurnArchive({ now: () => 100 })
  const r = registry(archive)
  r.register({ sessionId: 's', incarnation: 'i', provider: 'claude-code', nodeId: 'node' })
  finish(r)
  r.revokeNodes(['node'])
  expect(() => r.finalMessage({ nodeId: 'node', turnId: 'turn' })).toThrow(
    expect.objectContaining({ details: { reason: 'turn_not_found' } }),
  )
  expect(() => r.finalMessage({ sessionId: 's', turnId: 'turn' })).toThrow(
    expect.objectContaining({ details: { reason: 'turn_not_found' } }),
  )
})

it('does not retroactively stamp an unbound end from a later binding', () => {
  const archive = new InMemoryAgentTurnArchive({ now: () => 100 }),
    append = vi.spyOn(archive, 'append')
  const r = registry(archive)
  r.register({ sessionId: 's', incarnation: 'i', provider: 'claude-code' })
  finish(r)
  r.bind('s', { nodeId: 'late' })
  expect(append).not.toHaveBeenCalled()
  expect(r.finalMessage({ sessionId: 's', turnId: 'turn' })).toMatchObject({
    nodeId: null,
    persisted: false,
    memoryOnlyReason: 'unbound',
  })
  expect(() => r.finalMessage({ nodeId: 'late', turnId: 'turn' })).toThrow(
    expect.objectContaining({ details: { reason: 'turn_not_found' } }),
  )
})

it('excludes remote executed turns from local archival and content reads', () => {
  const archive = new InMemoryAgentTurnArchive({ now: () => 100 }),
    append = vi.spyOn(archive, 'append')
  const r = registry(archive)
  r.register({ sessionId: 's', incarnation: 'i', provider: 'claude-code', nodeId: 'node' })
  r.setRuntimeContext('s', { remote: true })
  finish(r)
  expect(append).not.toHaveBeenCalled()
  expect(() => r.finalMessage({ nodeId: 'node', turnId: 'turn' })).toThrow(
    expect.objectContaining({ details: { reason: 'remote_history_unavailable' } }),
  )
})

it('keeps a committed memory reply readable on outage but distinguishes archive failure after restart', () => {
  const archive = new InMemoryAgentTurnArchive({ now: () => 100 }),
    r = registry(archive)
  r.register({ sessionId: 's', incarnation: 'i', provider: 'claude-code', nodeId: 'node' })
  finish(r)
  vi.spyOn(archive, 'getExact').mockImplementation(() => {
    throw new Error('io')
  })
  expect(r.finalMessage({ nodeId: 'node', turnId: 'turn' })).toMatchObject({
    message: 'reply',
    persisted: true,
  })
  r.dispose()
  expect(() => registry(archive).finalMessage({ nodeId: 'node', turnId: 'turn' })).toThrow(
    expect.objectContaining({ details: { reason: 'archive_unavailable' } }),
  )
})

it('classifies durable remote misses after restart, while a valid local historical hit wins', () => {
  const archive = new InMemoryAgentTurnArchive({ now: () => 100 })
  const r = new AgentRunStateRegistry({
    archive,
    membership: () => 'member',
    isRemote: () => true,
    epoch: 'e',
    now: () => 100,
    createTurnId: () => 'unused',
    schedule: () => () => {},
  })
  expect(() => r.finalMessage({ nodeId: 'remote', turnId: 'old' })).toThrow(
    expect.objectContaining({ details: { reason: 'remote_history_unavailable' } }),
  )
  archive.append(endedTurn({ nodeId: 'remote', turnId: 'old' }))
  expect(r.finalMessage({ nodeId: 'remote', turnId: 'old' })).toMatchObject({
    persisted: true,
    message: 'reply',
  })
})
