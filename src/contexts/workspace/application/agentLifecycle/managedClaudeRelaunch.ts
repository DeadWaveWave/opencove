import type {
  ManagedClaudeBindingObservation,
  ManagedClaudeLaunchIntent,
} from '../../../../shared/contracts/managedClaudeLaunch'

/** UI intent is explicit; durable expectations are captured once at interaction start. */
export function planManagedClaudeRelaunch(
  binding: ManagedClaudeBindingObservation | null,
  mode: 'new' | 'resume',
  resumeSessionId?: string | null,
): ManagedClaudeLaunchIntent | undefined {
  if (!binding) {
    return undefined
  }
  const expected = { activationId: binding.activationId, tuple: binding.tuple }
  if (mode === 'new') {
    return { kind: 'launchNew', expected }
  }
  return resumeSessionId === undefined
    ? { kind: 'resumeCurrent' }
    : { kind: 'resumeConversation', resumeSessionId: resumeSessionId!, expected }
}
