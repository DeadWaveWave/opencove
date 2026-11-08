// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { AgentRunStateRegistry } from '../../../src/contexts/agent/application/AgentRunStateRegistry'
import { createAgentTurnArchive } from '../../../src/contexts/agent/application/createAgentTurnArchive'
import type { AgentTurnArchive } from '../../../src/contexts/agent/application/AgentTurnArchive'
import { InMemoryAgentTurnArchive } from '../../support/agentTurnArchive/InMemoryAgentTurnArchive'
import { endedTurn } from '../../support/agentTurnArchive/agentTurnArchiveContract'

function fixture(
  archive: AgentTurnArchive = new InMemoryAgentTurnArchive({ now: () => 1000 }),
  noArchive = false,
) {
  let seq = 0,
    turn = 0
  const registry = new AgentRunStateRegistry({
    epoch: 'epoch',
    now: () => 1000,
    createTurnId: () => `t${++turn}`,
    schedule: () => () => {},
    archive: noArchive ? undefined : archive,
    membership: () => 'member',
  })
  const register = (sessionId = 's', nodeId = 'node', incarnation = 'i') =>
    registry.register({ sessionId, nodeId, incarnation, provider: 'claude-code' })
  const hook = (end = false, sessionId = 's', incarnation = 'i') => {
    registry.observe(
      sessionId,
      {
        incarnation,
        source: 'claude_hook',
        sourceSequence: ++seq,
        observedAt: seq,
        emittedAtMs: seq,
        hookEventName: end ? 'Stop' : 'UserPromptSubmit',
        state: end ? 'idle' : 'working',
        boundary: end
          ? { kind: 'end', outcome: 'completed' }
          : { kind: 'start', evidence: 'prompt_submit' },
      },
      {
        providerSessionId: sessionId,
        promptId: `${sessionId}-${incarnation}-${end ? seq - 1 : seq}`,
        ...(end ? { finalMessage: { message: 'reply', truncated: false } } : {}),
      },
    )
  }
  register()
  return { registry, archive, register, hook }
}

it('removes archive and memory records across retained incarnations by stamped node ownership', () => {
  const f = fixture()
  f.hook()
  f.hook(true)
  f.register('second')
  f.hook(false, 'second')
  f.hook(true, 'second')
  f.registry.bind('s', { nodeId: 'other-binding' })
  f.register('unrelated', 'other')
  f.hook(false, 'unrelated')
  f.hook(true, 'unrelated')
  f.archive.append(endedTurn({ turnId: 'old', sessionId: 'replaced' }))
  const before = f.registry.list()
  expect(f.registry.clearHistory('node')).toEqual({
    nodeId: 'node',
    memoryRemoved: 2,
    archive: { status: 'cleared', removed: 3 },
  })
  expect(f.registry.list()).toEqual(before)
  for (const [sessionId, turnId] of [
    ['s', 't1'],
    ['second', 't2'],
    ['replaced', 'old'],
  ]) {
    expect(() => f.registry.finalMessage({ sessionId, turnId })).toThrow(
      expect.objectContaining({ details: { reason: 'turn_not_found' } }),
    )
  }
  expect(() => f.registry.finalMessage({ sessionId: 's' })).toThrow()
  expect(f.registry.finalMessage({ nodeId: 'other', turnId: 't3' })).toMatchObject({
    message: 'reply',
  })
})

it('clears idempotently without revoking the node', () => {
  const f = fixture()
  f.hook()
  f.hook(true)
  f.registry.clearHistory('node')
  expect(f.registry.clearHistory('node')).toEqual({
    nodeId: 'node',
    memoryRemoved: 0,
    archive: { status: 'cleared', removed: 0 },
  })
  f.hook()
  f.hook(true)
  expect(f.registry.finalMessage({ nodeId: 'node', turnId: 't2' })).toMatchObject({
    persisted: true,
  })
})

it('preserves the active turn, fences and receipts and stores its later end normally', () => {
  const f = fixture()
  f.hook()
  f.hook(true)
  f.hook()
  const fence = f.registry.readFence({ nodeId: 'node' })!
  const identity = f.registry.promptIdentity(fence)
  const receipt = vi.fn()
  const unwatch = f.registry.watchFence(fence, receipt)
  const snapshot = f.registry.list()
  f.registry.clearHistory('node')
  expect(f.registry.list()).toEqual(snapshot)
  expect(f.registry.readFence({ nodeId: 'node' })).toEqual(fence)
  expect(f.registry.promptIdentity(fence)).toMatchObject({ promptId: identity!.promptId })
  expect(receipt).not.toHaveBeenCalled()
  f.hook(true)
  expect(f.registry.finalMessage({ nodeId: 'node', turnId: 't2' })).toMatchObject({
    message: 'reply',
    persisted: true,
  })
  unwatch()
})

it.each(['missing', 'disabled', 'throws'] as const)(
  'clears memory when archive is unavailable: %s',
  mode => {
    const f = fixture(
      mode === 'disabled' ? createAgentTurnArchive(null) : undefined,
      mode === 'missing',
    )
    f.hook()
    f.hook(true)
    if (mode === 'throws') {
      vi.spyOn(f.archive, 'clearNode').mockImplementation(() => {
        throw new Error('I/O')
      })
    }
    expect(f.registry.clearHistory('node')).toEqual({
      nodeId: 'node',
      memoryRemoved: 1,
      archive: { status: 'unavailable' },
    })
    // Force archive read failure as well: no deleted content may survive in memory.
    vi.spyOn(f.archive, 'getExact').mockReturnValue({ status: 'unavailable' })
    expect(() => f.registry.finalMessage({ nodeId: 'node', turnId: 't1' })).toThrow()
    expect(() => f.registry.finalMessage({ nodeId: 'node' })).toThrow()
  },
)

it('retains sixty ended turns in memory and evicts the sixty-first oldest record', () => {
  const f = fixture(createAgentTurnArchive(null))
  for (let i = 0; i < 60; i++) {
    f.hook()
    f.hook(true)
  }
  expect(f.registry.finalMessage({ nodeId: 'node', turnId: 't1' })).toMatchObject({
    message: 'reply',
  })
  f.hook()
  f.hook(true)
  expect(() => f.registry.finalMessage({ nodeId: 'node', turnId: 't1' })).toThrow()
  expect(f.registry.finalMessage({ nodeId: 'node', turnId: 't2' })).toMatchObject({
    message: 'reply',
  })
})

it('reports a remote agent instead of claiming its Worker-held replies were cleared', () => {
  const f = fixture()
  f.registry.setRuntimeContext('s', { remote: true })
  expect(f.registry.clearHistory('node')).toMatchObject({ nodeId: 'node', remote: true })
  expect(f.registry.clearHistory('other')).not.toHaveProperty('remote')
})
