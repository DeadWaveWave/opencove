import type { PiAgentSnapshot } from '../../../shared/contracts/dto/piAgentSnapshot'
import type { AgentSessionIdentityObservation } from '../../../shared/contracts/dto/agentSessionIdentityObservation'

export type PiAgentIdentityObservation = Extract<
  AgentSessionIdentityObservation,
  {
    identityAuthority: 'provider_session_snapshot'
  }
>

export interface PiAgentObservation {
  state: PiAgentSnapshot['state']
  snapshot: PiAgentSnapshot
  identity: PiAgentIdentityObservation | null
  resumeSessionId: string | null
}

/** One owner per launch credential, shared by managed and terminal Pi launches.
 * Transport authenticates first. This owner fences process/reload order before any state or
 * identity can escape. It owns runtime evidence only, not the durable workspace binding.
 */
export class PiAgentObservationOwner {
  private current: PiAgentSnapshot | null = null
  private resumeSessionId: string | null = null
  private disposed = false

  public accept(snapshot: PiAgentSnapshot): PiAgentObservation | null {
    const previous = this.current
    if (
      this.disposed ||
      (previous &&
        (snapshot.pid !== previous.pid ||
          snapshot.sequence <= previous.sequence ||
          snapshot.conversationRevision < previous.conversationRevision ||
          (snapshot.conversationRevision === previous.conversationRevision &&
            (snapshot.sessionId !== previous.sessionId ||
              snapshot.sessionFile !== previous.sessionFile))))
    ) {
      return null
    }
    const switched = snapshot.conversationRevision > (previous?.conversationRevision ?? 1)
    const resumed = snapshot.persistence === 'resumable' ? snapshot.sessionFile : null
    // Allocation/file absence never revokes a verified identity in the same conversation.
    // A declared conversation switch or explicit no-session mode does revoke the old binding.
    const shouldClear = snapshot.persistence === 'ephemeral' || switched
    const nextResumeSessionId = resumed ?? (shouldClear ? null : this.resumeSessionId)
    const changed =
      nextResumeSessionId !== this.resumeSessionId || (shouldClear && (!previous || switched))
    this.current = { ...snapshot }
    this.resumeSessionId = nextResumeSessionId
    return {
      state: snapshot.state,
      snapshot: { ...snapshot },
      resumeSessionId: this.resumeSessionId,
      identity: changed
        ? {
            identityAuthority: 'provider_session_snapshot',
            sequence: snapshot.sequence,
            resumeSessionId: nextResumeSessionId,
          }
        : null,
    }
  }

  public dispose(): void {
    this.disposed = true
    this.current = null
    this.resumeSessionId = null
  }
}
