import { describe, it, expect } from 'vitest'
import { normalizeLaunchAgentPayload } from '../../../src/shared/contracts/controlSurface/operations/sessionNormalize'
import { normalizeLaunchAgentInMountPayload } from '../../../src/shared/contracts/controlSurface/operations/sessionMountNormalize'
import { resolveManagedClaudeLaunchIntent } from '../../../src/contexts/agent/application/managedClaudeLaunch/managedClaudeLaunchIntent'

const absent = {
  activationId: null,
  tuple: { resumeSessionId: null, resumeSessionIdVerified: false },
}
const binding = {
  nodeId: 'agent',
  activationId: 'b',
  runtimeSessionId: 'runtime',
  tuple: { resumeSessionId: 'B', resumeSessionIdVerified: true },
  nodeSeen: true,
  bindingRevision: 3,
  observedRevision: 3,
}
const observation = { nodeId: 'agent', binding, retired: false, context: null }
describe('managed Claude launch intent', () => {
  it('resumeCurrent ignores owned client cache', () => {
    expect(
      resolveManagedClaudeLaunchIntent(observation, {
        intent: { kind: 'resumeCurrent' },
        mode: 'resume',
        resumeSessionId: 'A',
      }),
    ).toMatchObject({
      mode: 'resume',
      resumeSessionId: 'B',
      expected: { activationId: 'b', tuple: binding.tuple },
    })
  })
  it('explicit switch compares activation and both tuple fields', () => {
    for (const expected of [
      absent,
      { activationId: 'b', tuple: { ...binding.tuple, resumeSessionIdVerified: false } },
    ]) {
      expect(() =>
        resolveManagedClaudeLaunchIntent(observation, {
          intent: { kind: 'resumeConversation', resumeSessionId: 'C', expected },
        }),
      ).toThrow()
    }
  })
  it('legacy different-ID resume fails before effects', () => {
    expect(() =>
      resolveManagedClaudeLaunchIntent(observation, { mode: 'resume', resumeSessionId: 'A' }),
    ).toThrow()
  })
  it('legacy no-row requests retain behavior and absence means ledger absence', () => {
    expect(
      resolveManagedClaudeLaunchIntent(
        { ...observation, binding: null },
        { mode: 'resume', resumeSessionId: 'A' },
      ),
    ).toBeNull()
    expect(
      resolveManagedClaudeLaunchIntent(
        { ...observation, binding: null },
        { intent: { kind: 'launchNew', expected: absent } },
      ),
    ).toMatchObject({ expected: absent, mode: 'new' })
  })
  it('preserves strict intent and derives consistent mirrors for intent-only wire input', () => {
    const intent = { kind: 'resumeConversation' as const, resumeSessionId: 'C', expected: absent }
    for (const normalize of [
      (input: object) => normalizeLaunchAgentPayload({ cwd: '/repo', prompt: '', ...input }),
      (input: object) =>
        normalizeLaunchAgentInMountPayload({ mountId: 'mount', prompt: '', ...input }),
    ]) {
      expect(normalize({ intent })).toMatchObject({ intent, mode: 'resume', resumeSessionId: 'C' })
      expect(() => normalize({ intent: { ...intent, extra: true } })).toThrow()
      expect(() => normalize({ intent, mode: 'new' })).toThrow()
      expect(() => normalize({ intent, resumeSessionId: 'D' })).toThrow()
    }
  })
})
