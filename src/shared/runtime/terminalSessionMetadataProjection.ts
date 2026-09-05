import type { TerminalSessionMetadataEvent } from '../contracts/dto'
import {
  isImmutableTerminalAgentIdentityAuthority,
  isTerminalAgentActivityStrictlyNewer,
  normalizeTerminalAgentActivitySnapshot,
  sameTerminalAgentActivitySnapshot,
} from './terminalAgentActivity'

import { normalizePiAgentSnapshot } from './piAgentSnapshot'

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
  const previousPi = normalizePiAgentSnapshot(previous?.piSnapshot)
  const incomingPi = normalizePiAgentSnapshot(incoming.piSnapshot)
  if (incoming.piSnapshot && (!incomingPi || incoming.agentProvider !== 'pi')) {
    return null
  }
  const newInvocation =
    incomingActivity &&
    (!previousActivity || incomingActivity.generation > previousActivity.generation)
  const advancesInvocation =
    previousActivity &&
    incomingActivity &&
    isTerminalAgentActivityStrictlyNewer(incomingActivity, previousActivity)
  if (
    previousPi &&
    incomingPi &&
    !newInvocation &&
    (incomingPi.pid !== previousPi.pid ||
      incomingPi.sequence < previousPi.sequence ||
      (incomingPi.sequence === previousPi.sequence && !advancesInvocation))
  ) {
    return null
  }
  const retainedPi = incomingPi ?? (newInvocation ? null : previousPi)
  const retainedActivity = incomingActivity ?? previousActivity
  const retainedProvider =
    incoming.agentProvider ?? incomingActivity?.provider ?? previous?.agentProvider ?? null
  const preservesVerifiedIdentity =
    (previousPi !== null && !incomingPi && !incomingActivity) ||
    (previousActivity !== null &&
      isImmutableTerminalAgentIdentityAuthority(previousActivity.identityAuthority) &&
      Boolean(previous?.resumeSessionId) &&
      (!incomingActivity ||
        (incomingActivity.provider === previousActivity.provider &&
          incomingActivity.invocationId === previousActivity.invocationId &&
          incomingActivity.generation === previousActivity.generation)))
  const next = {
    ...incoming,
    ...(retainedProvider ? { agentProvider: retainedProvider } : {}),
    resumeSessionId: preservesVerifiedIdentity
      ? (previous?.resumeSessionId ?? null)
      : incoming.resumeSessionId,
    ...(retainedActivity ? { terminalAgentActivity: retainedActivity } : {}),
    ...(retainedPi ? { piSnapshot: retainedPi } : {}),
  }
  const unchanged =
    previous?.resumeSessionId === next.resumeSessionId &&
    previous?.agentProvider === next.agentProvider &&
    previous?.profileId === next.profileId &&
    previous?.runtimeKind === next.runtimeKind &&
    previousPi?.sequence === retainedPi?.sequence &&
    sameTerminalAgentActivitySnapshot(previousActivity, retainedActivity)
  return unchanged ? null : next
}
