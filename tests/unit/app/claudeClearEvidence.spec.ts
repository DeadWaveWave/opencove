// @vitest-environment node
import { expect, it, vi } from 'vitest'
import {
  normalizeClaudeHookEnvelope,
  validateClaudeHookEnvelope,
} from '../../../src/app/main/controlSurface/agentHook/claudeHookProtocol'
import { clearIngressFixture } from './claudeClearIngress.helpers'
import { promptAdmission } from '../../../src/contexts/agent/application/promptAdmission'

it.each(['clear', 'logout', undefined])(
  'preserves only explicit SessionEnd clear evidence, reason=%s',
  reason => {
    const raw = normalizeClaudeHookEnvelope({
      session_id: 'A',
      hook_event_name: 'SessionEnd',
      transcript_path: '/untrusted/A.jsonl',
      cwd: '/',
      reason,
    })!
    const versioned = validateClaudeHookEnvelope({
      version: 1,
      claudeSessionId: 'A',
      hookEventName: 'SessionEnd',
      state: 'done',
      reason,
    })!
    expect(raw.sessionEndReason).toBe(reason === 'clear' ? 'clear' : undefined)
    expect(versioned.sessionEndReason).toBe(raw.sessionEndReason)
    expect(
      normalizeClaudeHookEnvelope({
        session_id: 'A',
        hook_event_name: 'SessionStart',
        transcript_path: '/untrusted/A.jsonl',
        cwd: '/',
        reason,
      })?.sessionEndReason,
    ).toBeUndefined()
  },
)
it('opens the live window on authenticated End(clear) before successor Start', async () => {
  const f = await clearIngressFixture(false)
  try {
    await f.send('A', 'SessionEnd', 10, undefined, undefined, { reason: 'clear' })
    expect(f.fence()).toMatchObject({ conversationQuarantined: true, claudeClearReady: false })
    expect(
      promptAdmission(f.fence(), () => ({ supported: true, submitDelayMs: 300 })),
    ).toMatchObject({ code: 'agent.state_unknown' })
    await f.send('B', 'SessionStart', 11, undefined, 'clear')
    await f.settle()
    expect(f.fence()).toMatchObject({
      conversationQuarantined: false,
      claudeClearReady: true,
      snapshot: { state: 'idle', turn: null },
    })
    expect(f.registry.promptIdentity(f.fence())?.providerSessionId).toBe('B')
  } finally {
    await f.close()
    vi.useRealTimers()
  }
})
