import type { JournalFact } from './ClaudeInvocationJournal'
import type { ClaudeJournalHistory } from './ClaudeJournalHistory'
import type { ClaudeConversationEvent } from '../../../shared/runtime/agentHook/claudeConversation'
import { boundedInsert } from '../../../shared/utils/boundedInsert'
export const CLAUDE_RECEIPT_PROVENANCE_LIMIT = 1024
export const isClaudeReceipt = (event: ClaudeConversationEvent): boolean =>
  ['UserPromptSubmit', 'Stop', 'StopFailure'].includes(event.hookEventName)
export const claudeHookKey = (event: ClaudeConversationEvent): string =>
  JSON.stringify([
    event.claudeSessionId,
    event.hookEventName,
    event.emittedAtMs,
    event.promptId,
    event.state,
    event.sessionStartSource,
    event.sessionEndReason,
  ])
type Origin = {
  order: number
  id: string
  at: number
  namespace: number | 'pending' | 'rejected'
  committed: boolean
  provisional: boolean
}
/** First observations include rejected ingress. Only an explicit Start can bind pending evidence. */
export class ClaudeJournalReceipts {
  private origins = new Map<string, Origin>()
  order(key: string): number | undefined {
    return this.origins.get(key)?.order
  }
  observe(
    fact: JournalFact,
    order: number,
    history: ClaudeJournalHistory,
    namespace: Origin['namespace'] = 'rejected',
    provisional = false,
  ): number {
    const known = this.order(fact.key)
    if (known !== undefined) {
      return known
    }
    const inserted = boundedInsert(
      this.origins.size,
      CLAUDE_RECEIPT_PROVENANCE_LIMIT,
      () =>
        this.origins.set(fact.key, {
          order,
          id: fact.id,
          at: fact.at,
          namespace,
          committed: false,
          provisional,
        }),
      () => history.truncate(),
    )
    return inserted ? order : 0
  }
  beginClear(at: number): void {
    for (const origin of this.origins.values()) {
      // Before the first clear, ordinary ingress has no namespace owner. Reconcile that
      // provisional annotation once, using the first authenticated transition timestamp.
      if (
        origin.provisional &&
        typeof origin.namespace === 'number' &&
        origin.namespace < at &&
        origin.at > at
      ) {
        origin.namespace = 'pending'
      }
      origin.provisional = false
    }
  }
  bind(id: string, start: number): void {
    for (const origin of this.origins.values()) {
      if (origin.namespace === 'pending' && origin.id === id && origin.at > start) {
        origin.namespace = start
      }
    }
  }
  belongs(key: string, start: number | undefined): boolean {
    const origin = this.origins.get(key.replace(/^complete:/u, ''))
    return (
      start !== undefined && typeof origin?.namespace === 'number' && origin.namespace === start
    )
  }
  claim(key: string, start: number | undefined): boolean {
    const origin = this.origins.get(key)
    if (!this.belongs(key, start) || !origin || origin.committed) {
      return false
    }
    origin.committed = true
    return true
  }
  dispose(): void {
    this.origins.clear()
  }
}
