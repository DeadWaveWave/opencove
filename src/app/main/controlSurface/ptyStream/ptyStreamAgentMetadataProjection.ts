import type { TerminalSessionMetadataEvent } from '../../../../shared/contracts/dto'
import {
  isTerminalAgentActivityStrictlyNewer,
  normalizeTerminalAgentActivitySnapshot,
  sameTerminalAgentActivitySnapshot,
} from '../../../../shared/runtime/terminalAgentActivity'

export function projectPtyStreamAgentMetadata(
  previous: TerminalSessionMetadataEvent | null,
  incoming: TerminalSessionMetadataEvent,
): TerminalSessionMetadataEvent | null {
  const previousActivity = normalizeTerminalAgentActivitySnapshot(previous?.terminalAgentActivity)
  const incomingActivity = normalizeTerminalAgentActivitySnapshot(incoming.terminalAgentActivity)
  if (incoming.terminalAgentActivity && !incomingActivity) {
    return null
  }
  if (
    previousActivity &&
    incomingActivity &&
    !sameTerminalAgentActivitySnapshot(previousActivity, incomingActivity) &&
    !isTerminalAgentActivityStrictlyNewer(incomingActivity, previousActivity)
  ) {
    return null
  }
  const retainedActivity = incomingActivity ?? previousActivity
  const retainedProvider =
    incoming.agentProvider ?? incomingActivity?.provider ?? previous?.agentProvider ?? null
  const preservesVerifiedIdentity =
    previousActivity?.identityAuthority === 'provider_session_start' &&
    Boolean(previous?.resumeSessionId) &&
    (!incomingActivity ||
      (incomingActivity.provider === previousActivity.provider &&
        incomingActivity.invocationId === previousActivity.invocationId &&
        incomingActivity.generation === previousActivity.generation))
  const next = {
    ...incoming,
    ...(retainedProvider ? { agentProvider: retainedProvider } : {}),
    resumeSessionId: preservesVerifiedIdentity
      ? (previous?.resumeSessionId ?? null)
      : incoming.resumeSessionId,
    ...(retainedActivity ? { terminalAgentActivity: retainedActivity } : {}),
  }
  const unchanged =
    previous?.resumeSessionId === next.resumeSessionId &&
    previous?.agentProvider === next.agentProvider &&
    previous?.profileId === next.profileId &&
    previous?.runtimeKind === next.runtimeKind &&
    sameTerminalAgentActivitySnapshot(previousActivity, next.terminalAgentActivity)
  return unchanged ? null : next
}
