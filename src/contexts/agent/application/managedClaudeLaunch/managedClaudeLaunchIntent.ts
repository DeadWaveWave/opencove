import {
  ABSENT_MANAGED_CLAUDE_BINDING,
  type ManagedClaudeLaunchIntent,
  type ManagedClaudeNodeObservation,
} from '../../../../shared/contracts/managedClaudeLaunch'
import { sameManagedResumeBinding } from '../../../../shared/contracts/managedClaudeResumeBinding'
import { rejectManagedLaunch } from './ManagedClaudeLaunchOwner'

export function resolveManagedClaudeLaunchIntent(
  observation: ManagedClaudeNodeObservation,
  input: {
    intent?: ManagedClaudeLaunchIntent
    mode?: string | null
    resumeSessionId?: string | null
  },
) {
  const { nodeId, binding } = observation
  if (observation.retired) {
    rejectManagedLaunch(nodeId, 'nodeGone')
  }
  const current = binding
    ? { activationId: binding.activationId, tuple: binding.tuple }
    : ABSENT_MANAGED_CLAUDE_BINDING
  let intent = input.intent
  if (!intent) {
    if (!binding) {
      return null
    }
    if (input.mode !== 'resume' || input.resumeSessionId !== binding.tuple.resumeSessionId) {
      rejectManagedLaunch(nodeId, 'intentRequired')
    }
    intent = { kind: 'resumeCurrent' }
  }
  if (
    intent.kind !== 'resumeCurrent' &&
    (intent.expected.activationId !== current.activationId ||
      !sameManagedResumeBinding(intent.expected.tuple, current.tuple))
  ) {
    rejectManagedLaunch(nodeId, 'conflict')
  }
  if (intent.kind === 'resumeCurrent' && !binding) {
    return null
  }
  if (intent.kind === 'resumeCurrent') {
    if (!current.tuple.resumeSessionId || !current.tuple.resumeSessionIdVerified) {
      rejectManagedLaunch(nodeId, 'resumeUnavailable')
    }
    return {
      expected: current,
      mode: 'resume' as const,
      resumeSessionId: current.tuple.resumeSessionId,
    }
  }
  return {
    expected: current,
    mode: intent.kind === 'launchNew' ? ('new' as const) : ('resume' as const),
    resumeSessionId: intent.kind === 'launchNew' ? null : intent.resumeSessionId,
  }
}
