import { describe, expect, it } from 'vitest'
import {
  createAgentRunModel,
  transitionAgentRun,
  type AgentRunObservation,
} from '../../../src/contexts/agent/domain/agentRunState'

const summary = {
  kind: 'question',
  questions: [{ question: 'Which?', options: ['One', 'Two'] }],
} as const
function fixture() {
  let model = createAgentRunModel({
    sessionId: 's',
    provider: 'claude-code',
    incarnation: 'i',
    now: 0,
  })
  let seq = 0
  return (input: Partial<AgentRunObservation> = {}) => {
    const observation = {
      incarnation: 'i',
      source: 'claude_hook',
      state: 'waiting',
      observedAt: ++seq,
      sourceSequence: seq,
      ...input,
    } as AgentRunObservation
    model = transitionAgentRun(model, observation, seq, () => `turn-${seq}`).model
    return model.snapshot
  }
}
describe('blocking episodes', () => {
  it('preserves reason and summary through same-source empty refreshes', () => {
    const observe = fixture()
    observe({ blockedReason: 'question', blockedSummary: summary })
    expect(observe()).toMatchObject({
      state: 'waiting',
      blockedReason: 'question',
      blockedSummary: summary,
    })
  })
  it('keeps the question when the provider also asks permission to show it', () => {
    const observe = fixture()
    observe({ blockedReason: 'question', blockedSummary: summary })
    expect(
      observe({ hookEventName: 'PermissionRequest', blockedReason: 'permission' }),
    ).toMatchObject({ blockedReason: 'question', blockedSummary: summary })
    expect(
      observe({ hookEventName: 'Notification', blockedReason: 'permission' }).blockedReason,
    ).toBe('question')
  })
  it('upgrades a permission episode to a question or plan, never back', () => {
    const observe = fixture()
    expect(
      observe({ hookEventName: 'PermissionRequest', blockedReason: 'permission' }).blockedReason,
    ).toBe('permission')
    expect(observe({ hookEventName: 'Notification' }).blockedReason).toBe('permission')
    expect(observe({ blockedReason: 'plan', blockedSummary: { kind: 'plan' } }).blockedReason).toBe(
      'plan',
    )
    expect(observe({ blockedReason: 'permission' }).blockedReason).toBe('plan')
  })
  it.each([
    { state: 'working' },
    { state: 'idle', boundary: { kind: 'end', outcome: 'completed' } },
    { state: 'waiting', boundary: { kind: 'reset' } },
    { state: 'working', boundary: { kind: 'start', evidence: 'prompt_submit' } },
  ] as const)('starts clean after $state / $boundary.kind', boundary => {
    const observe = fixture()
    observe({ blockedReason: 'question', blockedSummary: summary })
    expect(observe(boundary).blockedSummary).toBeNull()
    expect(observe()).toMatchObject({ blockedReason: null, blockedSummary: null })
  })
  it('ignores non-authoritative resolution, stale and wrong-incarnation evidence', () => {
    const observe = fixture()
    observe({ blockedReason: 'question', blockedSummary: summary })
    expect(observe({ source: 'session_file', state: 'working' }).blockedSummary).toEqual(summary)
    expect(observe({ state: 'idle', observedAt: 0 }).blockedSummary).toEqual(summary)
    expect(observe({ incarnation: 'old', state: 'idle' }).blockedSummary).toEqual(summary)
    expect(observe({ source: 'exit', state: 'exited' })).toMatchObject({
      blockedReason: null,
      blockedSummary: null,
    })
  })
})
it('does not treat temporary unavailable evidence as dialog resolution', () => {
  const observe = fixture()
  observe({ blockedReason: 'question', blockedSummary: summary })
  expect(observe({ state: 'unknown', degraded: true })).toMatchObject({
    state: 'unknown',
    blockedReason: null,
    blockedSummary: null,
  })
  expect(observe()).toMatchObject({
    state: 'waiting',
    blockedReason: 'question',
    blockedSummary: summary,
  })
})
