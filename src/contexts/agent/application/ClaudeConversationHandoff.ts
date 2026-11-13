import type { ClaudeTranscriptObservation } from '../../../shared/runtime/agentHook/claudeTranscript'
import { getClaudeTranscriptInput } from '../../../shared/runtime/agentHook/claudeTranscript'
import type { ClaudeConversationEvent } from '../../../shared/runtime/agentHook/claudeConversation'
import { isClaudeConversationActivity } from '../domain/ClaudeConversationLifecycle'
import type { AgentRunEntry } from './AgentRunStateEntry'

type Fact = { record: ClaudeTranscriptObservation; at: number }
/** Annotation-only before the first clear: no classifier reads, publications or timers.
 * On handoff these facts join the existing bounded event-time owner, never a second reducer. */
export class ClaudeConversationHandoff {
  private facts: Fact[] = []
  private limited = false
  private retained?: { id: string; at: number }
  observe(record: ClaudeTranscriptObservation, now: number): void {
    const event = record.conversation?.event
    if (event && !isClaudeConversationActivity(event)) {
      return
    }
    if (!event && !record.activity && !this.isInput(record)) {
      return
    }
    if (this.facts.length === 64) {
      this.facts.shift()
      this.limited = true
    }
    this.facts.push({ record, at: event?.emittedAtMs ?? record.activity?.observedAt ?? now })
  }
  take(entry: AgentRunEntry, first: ClaudeConversationEvent): ClaudeTranscriptObservation[] {
    const original = entry.conversation?.providerSessionId
    const firstAt = first.emittedAtMs ?? -Infinity
    this.facts = this.facts.filter(f => f.record.providerSessionId !== original || f.at >= firstAt)
    const observed = entry.model.observations.claude_hook
    const match = this.facts.findLast(f => {
      const event = f.record.conversation?.event
      return (
        event &&
        event.emittedAtMs === observed?.emittedAtMs &&
        event.hookEventName === observed?.hookEventName &&
        (event.state === 'working' ||
          event.state === 'waiting' ||
          (event.hookEventName === 'Stop' &&
            entry.history.hasEndedPrompt(event.promptId, event.claudeSessionId)))
      )
    })
    if (match) {
      this.retained = { id: match.record.providerSessionId, at: match.at }
    }
    return this.facts.filter(f => f.record.conversation).map(f => f.record)
  }
  preserve(event: ClaudeConversationEvent): boolean {
    if (!this.retained || event.emittedAtMs === undefined) {
      return false
    }
    if (event.hookEventName === 'UserPromptSubmit') {
      // It already created the retained turn. Re-publishing it would enqueue a continuation.
      return (
        event.claudeSessionId === this.retained.id &&
        event.emittedAtMs <= this.retained.at &&
        this.facts.some(
          f =>
            f.record.conversation?.event.hookEventName === 'UserPromptSubmit' &&
            f.record.providerSessionId === event.claudeSessionId &&
            f.at === event.emittedAtMs,
        )
      )
    }
    return (
      ['SessionStart', 'SessionEnd'].includes(event.hookEventName) &&
      event.emittedAtMs < this.retained.at
    )
  }
  establish(entry: AgentRunEntry, id: string): void {
    const owner = entry.conversation!
    for (const fact of this.facts) {
      if (fact.record.providerSessionId !== id || fact.record.conversation) {
        continue
      }
      const record = fact.record.record
      const promptId = record?.kind === 'user' ? record.promptId : undefined
      if (
        promptId &&
        (entry.history.hasCurrentPrompt({ providerSessionId: id, promptId }) ||
          entry.history.hasEndedPrompt(promptId, id))
      ) {
        continue
      }
      // A previously observed, later matching hook already confirms this IO evidence.
      if (
        this.facts.some(
          other =>
            other.record.providerSessionId === id &&
            other.record.conversation &&
            other.at >= fact.at &&
            ['UserPromptSubmit', 'Stop'].includes(other.record.conversation.event.hookEventName) &&
            (!promptId || other.record.conversation.event.promptId === promptId),
        )
      ) {
        continue
      }
      owner.veto()
      owner.input.block(fact.at, promptId)
    }
    if (this.limited) {
      owner.veto()
    }
  }
  private isInput(record: ClaudeTranscriptObservation): boolean {
    const input = record.record
    return (
      !!input &&
      getClaudeTranscriptInput(input) === undefined &&
      (input.kind === 'user' ||
        input.kind === 'queue' ||
        (input.kind === 'invalid_user' && input.input !== false))
    )
  }
}
