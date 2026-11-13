import type { JournalFact } from './ClaudeInvocationJournal'
import type { ClaudeJournalHistory } from './ClaudeJournalHistory'
import type { ClaudeJournalProof } from './ClaudeJournalProof'
export const CLAUDE_RECEIPT_PROVENANCE_LIMIT = 1024
type Origin = {
  fact: JournalFact
  order: number
  namespace?: number
  pairedWith?: string
  startAt?: number
}
/** Immutable first observations outlive projected bodies. No eviction can turn a replay
 * into a fresh receipt. Unindexable identities never certify post-truncation completion. */
export class ClaudeJournalReceipts {
  private origins = new Map<string, Origin>()
  observe(
    fact: JournalFact,
    order: number,
    history: ClaudeJournalHistory,
    proof: ClaudeJournalProof,
    bind = true,
  ): number {
    if (fact.kind !== 'finish' && fact.hookName !== 'UserPromptSubmit') {
      return order
    }
    const known = this.origins.get(fact.key)
    if (known) {
      return known.order
    }
    if (this.origins.size === CLAUDE_RECEIPT_PROVENANCE_LIMIT) {
      history.truncate(order)
      return 0
    }
    this.origins.set(fact.key, {
      fact: { ...fact, order },
      order,
      namespace: bind ? proof.epoch(fact)?.at : undefined,
    })
    return order
  }
  pair(proof: ClaudeJournalProof, history: ClaudeJournalHistory): void {
    if (!history.incomplete || !proof.current) {
      return
    }
    for (const stop of proof.completion) {
      const origin = this.origins.get(stop.key.replace(/^complete:/u, ''))
      if (
        !origin ||
        origin.pairedWith ||
        !history.qualifies(origin.order) ||
        (origin.namespace !== undefined && origin.namespace !== proof.current.at)
      ) {
        continue
      }
      const submit = [...this.origins.values()].find(
        s =>
          s.fact.hookName === 'UserPromptSubmit' &&
          !s.pairedWith &&
          history.qualifies(s.order) &&
          (s.namespace === undefined || s.namespace === proof.current!.at) &&
          s.fact.id === stop.id &&
          s.fact.at < stop.at &&
          s.fact.promptId === stop.promptId &&
          proof.epoch(s.fact) === proof.current,
      )
      if (submit) {
        origin.pairedWith = submit.fact.key
        origin.startAt = proof.current.at
        submit.pairedWith = origin.fact.key
      }
    }
  }
  qualifies(stop: JournalFact, start: JournalFact, history: ClaudeJournalHistory): boolean {
    const origin = this.origins.get(stop.key.replace(/^complete:/u, ''))
    const submit = origin?.pairedWith && this.origins.get(origin.pairedWith)
    return (
      !!origin &&
      !!submit &&
      origin.startAt === start.at &&
      history.qualifies(origin.order) &&
      history.qualifies(submit.order)
    )
  }
  hasSubmission(id: string, at: number | undefined, promptId: string | undefined): boolean {
    return [...this.origins.values()].some(
      o =>
        o.fact.hookName === 'UserPromptSubmit' &&
        o.fact.id === id &&
        o.fact.at === at &&
        o.fact.promptId === promptId,
    )
  }
  dispose(): void {
    this.origins.clear()
  }
}
