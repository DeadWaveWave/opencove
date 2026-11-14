import type { ManagedClaudeNodeObservation } from '../../../../shared/contracts/managedClaudeLaunch'
import { sameManagedResumeBinding } from '../../../../shared/contracts/managedClaudeResumeBinding'
import type { ManagedClaudeLaunchAttempt } from './types'

export interface ManagedClaudeExecution {
  provider: string
  cwd: string
  mountId: string | null
}

/** Validate the requested execution independently of cached effect admission. */
export function managedClaudeAdmissionDecision(
  attempt: ManagedClaudeLaunchAttempt,
  observation: ManagedClaudeNodeObservation,
  execution: ManagedClaudeExecution,
):
  | 'managed'
  | /* @compat managed-claude-worker-support */ 'legacy'
  | 'identityConflict'
  | 'conflict' {
  const context = attempt.context
  if (
    JSON.stringify(observation.context) !== JSON.stringify(context) ||
    (context &&
      (context.kind !== 'agent' ||
        context.provider !== execution.provider ||
        (observation.binding && context.directory && context.directory !== execution.cwd)))
  ) {
    return 'identityConflict'
  }
  const route = context
    ? (JSON.parse(context.route) as { endpointId: string; mountId: string | null } | null)
    : null
  if (route && (route.endpointId !== 'local' || route.mountId !== execution.mountId)) {
    // @compat managed-claude-worker-support
    if (
      !observation.binding &&
      route.endpointId === 'local' &&
      execution.mountId === null &&
      context?.directory === execution.cwd
    ) {
      return 'legacy'
    }
    return 'identityConflict'
  }
  if (
    attempt.expected &&
    (attempt.expected.activationId !== (observation.binding?.activationId ?? null) ||
      !sameManagedResumeBinding(
        attempt.expected.tuple,
        observation.binding?.tuple ?? { resumeSessionId: null, resumeSessionIdVerified: false },
      ))
  ) {
    return 'conflict'
  }
  // @compat managed-claude-worker-support
  // PR2 cannot atomically adopt a changed directory. Preserve unowned legacy switches.
  if (!observation.binding && context?.directory && context.directory !== execution.cwd) {
    return 'legacy'
  }
  return 'managed'
}
