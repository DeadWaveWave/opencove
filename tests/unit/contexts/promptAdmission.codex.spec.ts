import { describe, expect, it } from 'vitest'
import { promptAdmission } from '../../../src/contexts/agent/application/promptAdmission'
import type { RunStateFence } from '../../../src/contexts/agent/application/ports/PromptDeliveryPorts'

function fence(extra: Partial<RunStateFence> = {}): RunStateFence {
  return {
    epoch: 'e',
    incarnation: 'i',
    bindingGeneration: 0,
    cursor: 1,
    remote: false,
    launchKind: 'managed',
    hookInstallState: 'installed',
    hookCoverage: 'lifecycle',
    lastTurnEnd: { source: 'codex_hook', sourceSequence: 2, observedAt: 1, hookEventName: 'Stop' },
    watermarks: { codex_hook: 2 },
    snapshot: {
      sessionId: 's',
      nodeId: 'n',
      provider: 'codex',
      state: 'idle',
      source: 'codex_hook',
      quality: 'authoritative',
      turn: null,
      blockedReason: null,
      lastTransitionAt: 1,
      turnOutcome: null,
    },
    ...extra,
  }
}
const capability = () => ({ supported: true as const, submitDelayMs: 300 })
describe('Codex prompt admission', () => {
  it('requires explicit lifecycle coverage and a settled selected Stop', () => {
    expect(promptAdmission(fence(), capability)).toBeNull()
  })
  it.each([
    [{ hookCoverage: 'notify_only' }, 'codex_hooks_notify_only'],
    [{ hookCoverage: 'none' }, 'codex_hooks_missing'],
    [{ hookCoverage: undefined }, 'codex_hooks_missing'],
    [{ hookCoverage: 'none', hookInstallState: 'skipped' }, 'codex_hooks_skipped'],
    [{ hookCoverage: 'none', hookInstallState: 'not_required' }, 'codex_hooks_not_required'],
    [{ hookCoverage: 'none', hookInstallState: 'not_installed' }, 'codex_hooks_not_installed'],
    [{ hookInstallState: 'partial' }, 'codex_hooks_partial'],
    [{ hookInstallState: 'error' }, 'codex_hooks_error'],
  ] satisfies [Partial<RunStateFence>, string][])(
    'refuses missing invocation support %j',
    (extra, reason) => {
      expect(promptAdmission(fence(extra), capability)).toEqual({
        code: 'agent.prompt_unsupported',
        reason,
      })
    },
  )
  it.each([
    [
      'session_file',
      'Stop',
      'authoritative',
      null,
      'agent.prompt_unsupported',
      'codex_lifecycle_observation_missing',
    ],
    ['codex_hook', 'notify', 'authoritative', null, 'agent.state_unknown', 'readiness_unobserved'],
    [
      'codex_hook',
      'SessionEnd',
      'authoritative',
      null,
      'agent.state_unknown',
      'readiness_unobserved',
    ],
    [
      'codex_hook',
      'StopFailure',
      'authoritative',
      null,
      'agent.state_unknown',
      'readiness_unobserved',
    ],
    ['codex_hook', 'Stop', 'degraded', null, 'agent.state_unknown', 'observation_degraded'],
    [
      'codex_hook',
      'Stop',
      'authoritative',
      { id: 't', startedAt: 1 },
      'agent.state_unknown',
      'readiness_unobserved',
    ],
  ] as const)(
    'requires readiness provenance %s/%s/%s',
    (source, event, quality, turn, code, reason) => {
      const f = fence({
        lastTurnEnd: { source, sourceSequence: 2, observedAt: 1, hookEventName: event },
      })
      Object.assign(f.snapshot, { source, quality, turn })
      expect(promptAdmission(f, capability)).toEqual({ code, reason })
    },
  )
  it.each([
    ['waiting', 'agent.blocked', 'waiting'],
    ['working', 'agent.busy', 'working'],
    ['exited', 'agent.not_running', 'not_running'],
  ] as const)('refuses %s', (state, code, reason) => {
    const f = fence()
    Object.assign(f.snapshot, { state, blockedReason: 'permission' })
    expect(promptAdmission(f, capability)).toEqual({ code, reason })
  })
})
