import type { JournalFact } from './ClaudeInvocationJournal'
import type { ClaudeJournalHistory } from './ClaudeJournalHistory'
import type { ClaudeConversationEvent } from '../../../shared/runtime/agentHook/claudeConversation'
export const CLAUDE_RECEIPT_PROVENANCE_LIMIT = 1024
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
/** First observations include rejected ingress. Origins never evict; saturation is terminal. */
export class ClaudeJournalReceipts {
  private origins = new Map<string, { order: number; namespace?: number }>()
  order(key: string): number | undefined {
    return this.origins.get(key)?.order
  }
  observe(
    fact: JournalFact,
    order: number,
    history: ClaudeJournalHistory,
    namespace?: number,
  ): number {
    const known = this.order(fact.key)
    if (known !== undefined) {
      return known
    }
    if (this.origins.size === CLAUDE_RECEIPT_PROVENANCE_LIMIT) {
      history.truncate()
      return 0
    }
    this.origins.set(fact.key, { order, namespace })
    return order
  }
  belongs(key: string, start: number | undefined): boolean {
    const origin = this.origins.get(key.replace(/^complete:/u, ''))
    return origin?.namespace === undefined || origin.namespace === start
  }
  dispose(): void {
    this.origins.clear()
  }
}
