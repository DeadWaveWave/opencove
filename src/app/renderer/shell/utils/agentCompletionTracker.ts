import type { AgentRunSnapshot } from '@shared/contracts/dto/agentRunState'

/** Tracks consumed Worker completion identities; never infers a turn from a UI label. */
export class AgentCompletionTracker {
  private readonly sessions = new Map<string, { endedAt: number; ids: Set<string> }>()

  constructor(private readonly listeningSince: number) {}

  consume(snapshot: AgentRunSnapshot, replay: boolean): boolean {
    const ended = snapshot.lastEndedTurn
    if (!ended) {
      return false
    }
    const previous = this.sessions.get(snapshot.sessionId)
    if (previous && (ended.endedAt < previous.endedAt || previous.ids.has(ended.id))) {
      return false
    }
    const ids = previous?.endedAt === ended.endedAt ? previous.ids : new Set<string>()
    ids.add(ended.id)
    this.sessions.set(snapshot.sessionId, { endedAt: ended.endedAt, ids })
    return (
      !replay &&
      ended.endedAt >= this.listeningSince &&
      snapshot.state === 'idle' &&
      snapshot.quality !== 'degraded' &&
      snapshot.turn === null
    )
  }

  forget(sessionId: string): void {
    this.sessions.delete(sessionId)
  }
}
