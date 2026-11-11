import { ABSENT_MANAGED_CLAUDE_BINDING } from '../../../../shared/contracts/managedClaudeLaunch'
import type {
  ManagedClaudeBindingObservation,
  ManagedClaudeLaunchIntent,
} from '../../../../shared/contracts/managedClaudeLaunch'

/** UI intent is explicit; durable expectations are captured once at interaction start. */
export function planManagedClaudeRelaunch(
  binding: ManagedClaudeBindingObservation | null,
  mode: 'new' | 'resume',
  resumeSessionId?: string | null,
  provider?: string,
): ManagedClaudeLaunchIntent | undefined {
  if (!binding && provider !== 'claude-code') {
    return undefined
  }
  const expected = binding
    ? { activationId: binding.activationId, tuple: binding.tuple }
    : ABSENT_MANAGED_CLAUDE_BINDING
  if (mode === 'new') {
    return { kind: 'launchNew', expected }
  }
  return resumeSessionId === undefined
    ? { kind: 'resumeCurrent' }
    : { kind: 'resumeConversation', resumeSessionId: resumeSessionId!, expected }
}
