import type { JournalFact } from './ClaudeInvocationJournal'
import type { ClaudeJournalProof } from './ClaudeJournalProof'
/** Constant-size unresolved-loss summary. Incompatible/unknown scopes are irrecoverable
 * within this invocation: no single completion can prove that it covers all of them. */
export class ClaudeJournalLoss {
  private scope?: {
    id: string
    start: number
    input: boolean
    promptId?: string
    at: number
    order: number
  }
  private opaque = false
  get blocked(): boolean {
    return this.opaque || this.scope !== undefined
  }
  lose(f: JournalFact, proof: ClaudeJournalProof): void {
    const epoch = proof.epoch(f)
    if (!epoch || epoch !== proof.current || !['activity', 'finish'].includes(f.kind)) {
      this.opaque = true
      return
    }
    const old = this.scope
    // A raw completion attempt cannot add input debt to the obligation it may resolve.
    if (f.kind === 'finish' && old?.id === f.id && old.start === epoch.at) return
    const next = {
      id: f.id,
      start: epoch.at,
      input: !!f.input,
      promptId: f.promptId,
      at: f.at,
      order: f.order! - (f.kind === 'finish' ? 1 : 0),
    }
    if (
      old &&
      (old.id !== next.id ||
        old.start !== next.start ||
        old.input !== next.input ||
        old.promptId !== next.promptId)
    ) {
      this.opaque = true
      return
    }
    this.scope = old
      ? { ...next, at: Math.max(old.at, next.at), order: Math.max(old.order, next.order) }
      : next
  }
  resolve(stop: JournalFact, proof: ClaudeJournalProof): void {
    const loss = this.scope,
      current = proof.current
    if (
      this.opaque ||
      !loss ||
      !current ||
      stop.order! <= loss.order ||
      current.id !== loss.id ||
      current.at !== loss.start ||
      proof.epoch(stop) !== current
    )
      return
    if (loss.input && loss.promptId ? stop.promptId === loss.promptId : stop.at >= loss.at)
      this.scope = undefined
  }
  dispose(): void {
    this.scope = undefined
    this.opaque = false
  }
}
