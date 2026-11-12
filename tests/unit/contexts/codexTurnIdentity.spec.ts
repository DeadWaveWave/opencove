import { expect, it } from 'vitest'
import { CodexTurnIdentity } from '../../../src/contexts/agent/application/CodexTurnIdentity'
import type { AgentRunObservation } from '../../../src/contexts/agent/domain/agentRunState'
const pair = (session = 'S', turn = 'A') => ({ providerSessionId: session, providerTurnId: turn })
const submit = (emittedAtMs?: number): AgentRunObservation => ({
  source: 'codex_hook',
  incarnation: 'i',
  observedAt: 100,
  sourceSequence: 1,
  state: 'working',
  emittedAtMs,
  hookEventName: 'UserPromptSubmit',
  boundary: { kind: 'start', evidence: 'prompt_submit' },
})
it('requires relay freshness for a provider-session switch, even after a local end', () => {
  const ids = new CodexTurnIdentity()
  ids.bind(pair(), 't1', 10)
  ids.end(pair(), false)
  expect(ids.rejects(submit(), pair('new'))).toBe(true)
  expect(ids.rejects(submit(9), pair('new'))).toBe(true)
  expect(ids.rejects(submit(11), pair('new'))).toBe(false)
  ids.bind(pair('new'), 't2', 11)
  expect(ids.rejects(submit(12), pair('S', 'unseen'))).toBe(true)
})
it('keeps legacy same-session missing-timestamp starts and never maps conflicting partial receipts', () => {
  const ids = new CodexTurnIdentity()
  ids.bind(pair(), 't1', 10)
  ids.end(pair(), false)
  expect(ids.rejects(submit(), pair('S', 'B'))).toBe(false)
  expect(ids.submissionTurnId(pair('S', 'B'), 't1')).toBeUndefined()
  expect(
    ids.submissionTurnId({ providerSessionId: 'wrong' }, 't1', { providerSessionId: 'S' }),
  ).toBeUndefined()
  expect(ids.submissionTurnId(undefined, 't1')).toBe('t1')
})
it('bounds identity tombstones independently of the message cache', () => {
  const ids = new CodexTurnIdentity()
  for (let i = 0; i < 1025; i++) {
    const identity = pair('S', String(i))
    ids.bind(identity, `t${i}`, i)
    ids.end(identity, false)
  }
  expect(ids.lookup(pair('S', '0'))).toBeUndefined()
  expect(ids.lookup(pair('S', '1'))).toBe('t1')
  expect(ids.endedTurnIds()).toHaveLength(1024)
})
