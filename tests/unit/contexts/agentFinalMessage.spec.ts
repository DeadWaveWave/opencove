import { expect, it } from 'vitest'
import { AgentRunStateRegistry } from '../../../src/contexts/agent/application/AgentRunStateRegistry'
import { AgentRunStateRuntime } from '../../../src/contexts/agent/application/AgentRunStateRuntime'
import { setPromptSubmissionEvidence } from '../../../src/shared/runtime/agentHook/claudePromptEvidence'
import type { TerminalSessionStateEvent } from '../../../src/shared/contracts/dto'

function fixture() {
  let time = 100,
    turn = 0
  const registry = new AgentRunStateRegistry({
    epoch: 'e',
    now: () => time,
    createTurnId: () => `t${++turn}`,
    schedule: () => () => {},
  })
  const runtime = new AgentRunStateRuntime(registry, () => ++time)
  runtime.captureLaunchIdentity('s', 'n')
  runtime.metadata({ sessionId: 's', agentProvider: 'claude-code', resumeSessionId: null })
  registry.bind('s', { nodeId: 'n' })
  const event = (
    name: string,
    promptId?: string,
    message?: string,
    providerSessionId = 'provider',
    emittedAtMs = time,
  ) => {
    const value: TerminalSessionStateEvent = {
      sessionId: 's',
      source: 'claude_hook',
      hookEventName: name,
      emittedAtMs,
      state: name === 'UserPromptSubmit' ? 'working' : 'standby',
    }
    setPromptSubmissionEvidence(value, {
      promptId,
      providerSessionId,
      ...(message === undefined ? {} : { finalMessage: { message, truncated: false } }),
    })
    runtime.observe(value)
  }
  return {
    registry,
    runtime,
    event,
    read: (selector = {}) => registry.finalMessage({ nodeId: 'n', ...selector }),
  }
}
function reason(read: () => unknown, expected: string) {
  expect(read).toThrow(
    expect.objectContaining({
      code: 'agent.final_message_unavailable',
      details: expect.objectContaining({ reason: expected }),
    }),
  )
}
it('stores ended content before callbacks, leaving all public projections and receipts content-free', () => {
  const f = fixture()
  const publicValues: unknown[] = []
  const completionReads: unknown[] = [],
    fenceReads: unknown[] = []
  const captureRead = (reads: unknown[]) => {
    try {
      reads.push({ result: f.read() })
    } catch (error) {
      reads.push({ error })
    }
  }
  f.registry.subscribe({ epoch: 'e', afterSeq: 0 }, {}, value => {
    publicValues.push(value)
    if (value.type === 'agent.turn_completed') {
      captureRead(completionReads)
    }
  })
  f.event('UserPromptSubmit', 'p')
  f.registry.watchFence(f.registry.readFence({ nodeId: 'n' })!, receipt => {
    publicValues.push(receipt)
    captureRead(fenceReads)
  })
  f.event('Stop', 'p', 'secret')
  expect
    .soft(completionReads)
    .toEqual([{ result: expect.objectContaining({ message: 'secret', turnId: 't1' }) }])
  expect
    .soft(fenceReads)
    .toEqual([{ result: expect.objectContaining({ message: 'secret', turnId: 't1' }) }])
  expect(f.read()).toEqual({
    nodeId: 'n',
    sessionId: 's',
    turnId: 't1',
    promptId: 'p',
    outcome: 'completed',
    message: 'secret',
    truncated: false,
    source: 'hook',
    endedAt: expect.any(Number),
    persisted: false,
    memoryOnlyReason: 'unavailable',
  })
  expect(
    JSON.stringify([f.registry.get({ nodeId: 'n' }), f.registry.list(), publicValues]),
  ).not.toContain('secret')
  expect(f.registry.get({ nodeId: 'n' })?.lastEndedTurn).toEqual({
    id: 't1',
    outcome: 'completed',
    endedAt: expect.any(Number),
  })
  f.runtime.dispose()
})
it('rejects conflicting provider sessions and replayed ends without overwriting results', () => {
  const f = fixture()
  f.event('UserPromptSubmit', 'a')
  f.event('UserPromptSubmit', 'b', undefined, 'another-provider-session')
  f.event('Stop', 'b', 'wrong')
  f.event('Stop', 'a', 'wrong', 'another-provider-session')
  reason(() => f.read({ turnId: 't1' }), 'turn_not_ended')
  expect(f.registry.get({ nodeId: 'n' })?.state).toBe('working')
  f.event('StopFailure', 'a', 'failure')
  f.event('UserPromptSubmit', 'a')
  f.runtime.observe({
    sessionId: 's',
    source: 'claude_hook',
    state: 'working',
    hookEventName: 'PreToolUse',
  })
  f.event('Stop', 'a', 'replacement')
  expect(f.registry.get({ nodeId: 'n' })?.state).toBe('idle')
  expect(f.read({ promptId: 'a' })).toMatchObject({
    outcome: 'failed',
    message: 'failure',
    turnId: 't1',
  })
  f.runtime.dispose()
})
it('queries only the newest end, preserves empty content, and withholds uncorrelated content', () => {
  const f = fixture()
  reason(() => f.read(), 'no_ended_turn')
  f.event('Stop', 'baseline', 'no-start')
  reason(() => f.read(), 'no_ended_turn')
  f.event('UserPromptSubmit', 'a')
  f.event('Stop', 'a', '')
  expect(f.read()).toMatchObject({ message: '' })
  f.event('UserPromptSubmit', 'b')
  reason(() => f.read({ promptId: 'b' }), 'turn_not_ended')
  f.event('Stop', undefined, 'unbound')
  reason(() => f.read(), 'provider_sent_no_message')
  expect(f.read({ turnId: 't1' })).toMatchObject({ message: '' })
  reason(() => f.read({ turnId: 'missing' }), 'turn_not_found')
  f.runtime.dispose()
})
it('evicts oldest entries at eight turns and releases history on incarnation replacement and retirement', () => {
  const f = fixture()
  for (let i = 1; i <= 9; i++) {
    f.event('UserPromptSubmit', `p${i}`)
    f.event('Stop', `p${i}`, 'x'.repeat(64 * 1024))
  }
  reason(() => f.read({ turnId: 't1' }), 'turn_not_found')
  expect(f.read({ turnId: 't2' })).toMatchObject({ message: 'x'.repeat(64 * 1024) })
  f.registry.register({ sessionId: 's', nodeId: 'n', incarnation: 'new', provider: 'claude-code' })
  reason(() => f.read(), 'no_ended_turn')
  f.registry.observe('s', {
    source: 'exit',
    state: 'exited',
    incarnation: 'new',
    observedAt: 1000,
    sourceSequence: 1,
  })
  expect(f.registry.retire({ sessionId: 's', incarnation: 'new' })).toBe(true)
  reason(() => f.read(), 'no_ended_turn')
  f.runtime.dispose()
})

it('bounds total UTF-8 message bytes independently of the record count', () => {
  const f = fixture()
  // The memory cache retains at most 512 KiB, after the shared 64 KiB per-reply cap.
  for (let i = 1; i <= 9; i++) {
    f.event('UserPromptSubmit', `p${i}`)
    f.event('Stop', `p${i}`, '🙂'.repeat(75 * 1024))
  }
  reason(() => f.read({ turnId: 't1' }), 'turn_not_found')
  expect(f.read({ turnId: 't2' })).toMatchObject({ promptId: 'p2', truncated: true })
  f.runtime.dispose()
})
it('uses only current node binding while allowing an exited old session until retirement', () => {
  const f = fixture()
  f.event('UserPromptSubmit', 'a')
  f.event('Stop', 'a', 'old')
  f.runtime.exit('s')
  f.registry.register({
    sessionId: 'replacement',
    nodeId: 'n',
    incarnation: 'new',
    provider: 'claude-code',
  })
  reason(() => f.read(), 'no_ended_turn')
  expect(f.registry.finalMessage({ sessionId: 's' })).toMatchObject({ message: 'old' })
  f.runtime.forget('s')
  reason(() => f.registry.finalMessage({ sessionId: 's' }), 'no_ended_turn')
  f.registry.dispose()
  reason(() => f.registry.finalMessage({ sessionId: 'replacement' }), 'no_ended_turn')
})
it('does not retain degraded ends as a completion, and keeps PTY exit unknown', () => {
  const f = fixture()
  f.event('UserPromptSubmit', 'a')
  f.runtime.observe({
    sessionId: 's',
    state: 'standby',
    source: 'claude_hook',
    hookEventName: 'Stop',
    degraded: true,
  })
  reason(() => f.read({ turnId: 't1' }), 'turn_not_ended')
  f.runtime.exit('s')
  reason(() => f.read({ turnId: 't1' }), 'provider_sent_no_message')
  expect(f.registry.get({ nodeId: 'n' })?.lastEndedTurn).toMatchObject({
    id: 't1',
    outcome: 'unknown',
  })
  expect(() => f.read({ turnId: 't1' })).toThrow(
    expect.objectContaining({ details: expect.objectContaining({ outcome: 'unknown' }) }),
  )
  f.runtime.dispose()
})

it('does not serve local content through a remote runtime context', () => {
  const f = fixture()
  f.event('UserPromptSubmit', 'a')
  f.event('Stop', 'a', 'local')
  f.registry.setRuntimeContext('s', { remote: true })
  reason(() => f.read(), 'no_ended_turn')
  f.runtime.dispose()
})

it.each([
  { observedAtMs: 0 },
  { degraded: true },
  { observationUnavailable: true },
  { source: 'session_file' as const },
])('does not supersede from an untrusted start: %j', overrides => {
  const f = fixture()
  f.event('UserPromptSubmit', 'a')
  const event: TerminalSessionStateEvent = {
    sessionId: 's',
    source: 'claude_hook',
    state: 'working',
    hookEventName: 'UserPromptSubmit',
    emittedAtMs: 102,
    ...overrides,
  }
  setPromptSubmissionEvidence(event, { promptId: 'b', providerSessionId: 'provider' })
  f.runtime.observe(event)
  expect(f.registry.get({ nodeId: 'n' })?.turn?.id).toBe('t1')
  reason(() => f.read({ turnId: 't1' }), 'turn_not_ended')
  f.event('Stop', 'a', 'a answer')
  expect(f.read({ promptId: 'a' })).toMatchObject({ turnId: 't1', message: 'a answer' })
  f.runtime.dispose()
})
it('keeps repeated identified submissions in the current turn until queue evidence resolves', () => {
  const f = fixture()
  f.event('UserPromptSubmit', 'a')
  f.event('UserPromptSubmit', 'a')
  expect(f.registry.get({ nodeId: 'n' })?.turn?.id).toBe('t1')
  f.event('Stop', 'a', 'a answer')
  reason(() => f.read({ turnId: 't1' }), 'turn_not_ended')
  expect(f.registry.get({ nodeId: 'n' })?.turn?.id).toBe('t1')
  f.runtime.dispose()
})

it('keeps each accepted start emission through duplicates and advances it on supersession', () => {
  const f = fixture()
  try {
    f.event('UserPromptSubmit', 'a', undefined, 'provider', 100)
    f.event('UserPromptSubmit', 'a', undefined, 'provider', 300)
    f.event('UserPromptSubmit', 'b', undefined, 'provider', 200)
    expect(f.registry.get({ nodeId: 'n' })).toMatchObject({
      turn: { id: 't2' },
      turnOutcome: 'unknown',
      lastEndedTurn: { id: 't1', outcome: 'unknown', endedAt: expect.any(Number) },
    })
    reason(() => f.read({ promptId: 'a' }), 'provider_sent_no_message')
    f.runtime.observe({
      sessionId: 's',
      source: 'claude_hook',
      state: 'working',
      hookEventName: 'PreToolUse',
      emittedAtMs: 0,
    })
    f.event('UserPromptSubmit', 'c', undefined, 'provider', 150)
    f.event('Stop', 'c', 'wrong')
    expect(f.registry.get({ nodeId: 'n' })).toMatchObject({ state: 'working', turn: { id: 't2' } })
    f.event('Stop', 'b', 'b answer')
    expect(f.read({ turnId: 't2' })).toMatchObject({
      promptId: 'b',
      message: 'b answer',
      outcome: 'completed',
    })
  } finally {
    f.runtime.dispose()
  }
})
