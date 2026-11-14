import type { ManagedClaudeLaunchIntent } from './managedClaudeLaunch'
import { createAppError } from '../errors/appError'

// @compat managed-claude-worker-support
/** Keep older Workers safe without treating omitted compatibility fields as user intent. */
export function resolveManagedClaudeLaunchMirrors(input: {
  intent?: ManagedClaudeLaunchIntent
  mode?: unknown
  resumeSessionId?: unknown
}) {
  const intent = input.intent
  if (!intent) {
    return {}
  }
  if (intent.kind !== 'launchNew' && intent.kind !== 'resumeConversation') {
    return { intent }
  }
  const mode = intent.kind === 'launchNew' ? ('new' as const) : ('resume' as const)
  const resumeSessionId = intent.kind === 'launchNew' ? null : intent.resumeSessionId
  if (
    (input.mode !== undefined && input.mode !== null && input.mode !== mode) ||
    (input.resumeSessionId !== undefined && input.resumeSessionId !== resumeSessionId)
  ) {
    throw createAppError('common.invalid_input')
  }
  return { intent, mode, resumeSessionId }
}
