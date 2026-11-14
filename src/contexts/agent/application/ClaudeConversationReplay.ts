import { boundedInsert } from '../../../shared/utils/boundedInsert'
import type { ClaudeTranscriptObservation } from '../../../shared/runtime/agentHook/claudeTranscript'
import type { ClaudeConversationEvent } from '../../../shared/runtime/agentHook/claudeConversation'
import type { AgentRunEntry } from './AgentRunStateEntry'
/** Immutable replay plan. It controls duplicate history projection, never readiness or sources. */
export class ClaudeConversationReplay {
  private facts: { record: ClaudeTranscriptObservation; at: number }[] = []
  private completedTurn?: string
  private completedOwner?: { id: string; at: number }
  private coveredSubmissions = new Set<string>()
  private appliedSubmissions = new Set<string>()
  private activePrompt?: { providerSessionId?: string; promptId?: string }
  private retained?: { id: string; at: number }
  constructor(
    records: ClaudeTranscriptObservation[],
    entry: AgentRunEntry,
    first: ClaudeConversationEvent,
  ) {
    for (const record of records) {
      boundedInsert(
        this.facts.length,
        64,
        () => this.facts.push({ record, at: record.conversation!.event.emittedAtMs ?? -Infinity }),
        () => entry.claudeJournal?.saturate(),
      )
    }
    if (entry.model.snapshot.turn) {
      this.activePrompt = entry.history.identity()
    }
    const original = entry.conversation?.providerSessionId
    const firstAt = first.emittedAtMs ?? -Infinity
    this.facts = this.facts.filter(
      f =>
        f.record.providerSessionId !== original ||
        (f.record.conversation !== undefined && f.at >= firstAt),
    )
    this.appliedSubmissions = this.index(
      this.facts
        .filter(f => f.record.conversation?.event.hookEventName === 'UserPromptSubmit')
        .map(f => `${f.record.providerSessionId}:${f.at}`),
      entry,
    )
    const completed = this.facts.filter(f => {
      const e = f.record.conversation?.event
      return (
        e?.hookEventName === 'Stop' && entry.history.hasEndedPrompt(e.promptId, e.claudeSessionId)
      )
    })
    this.coveredSubmissions = this.index(
      this.facts
        .filter(
          f =>
            f.record.conversation?.event.hookEventName === 'UserPromptSubmit' &&
            completed.some(
              c => c.record.providerSessionId === f.record.providerSessionId && c.at >= f.at,
            ),
        )
        .map(f => `${f.record.providerSessionId}:${f.at}`),
      entry,
    )
    const ended = entry.model.snapshot.lastEndedTurn
    const archived = ended && entry.history.exact(ended.id)
    const proof = completed.findLast(
      f => f.record.providerSessionId === archived?.providerSessionId,
    )
    if (proof && ended) {
      this.completedTurn = ended.id
      this.completedOwner = { id: proof.record.providerSessionId, at: proof.at }
    }
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
    if (
      match &&
      (!entry.model.snapshot.turn ||
        entry.history.identity().providerSessionId === match.record.providerSessionId)
    ) {
      this.retained = { id: match.record.providerSessionId, at: match.at }
      if (match.record.conversation?.event.hookEventName === 'Stop') {
        this.completedTurn = entry.model.snapshot.lastEndedTurn?.id
      }
    }
  }
  private index(keys: string[], entry: AgentRunEntry): Set<string> {
    const set = new Set<string>()
    for (const key of keys) {
      boundedInsert(
        set.size,
        64,
        () => set.add(key),
        () => entry.claudeJournal?.saturate(),
      )
    }
    return set
  }
  dispose(): void {
    this.facts = []
    this.coveredSubmissions.clear()
    this.appliedSubmissions.clear()
    this.completedTurn = this.completedOwner = this.activePrompt = this.retained = undefined
  }
  takeRecords(): ClaudeTranscriptObservation[] {
    const records = this.facts.map(f => f.record)
    this.facts = []
    return records
  }
  completedReceipt(id: string | undefined, at: number | undefined): boolean {
    return id !== undefined && this.completedOwner?.id === id && this.completedOwner.at === at
  }
  adoptedCompletion(entry: AgentRunEntry): boolean {
    return (
      !!this.completedTurn &&
      entry.conversation?.providerSessionId === this.completedOwner?.id &&
      (entry.conversation?.startedAt ?? Infinity) < (this.completedOwner?.at ?? -Infinity) &&
      entry.model.snapshot.lastEndedTurn?.id === this.completedTurn
    )
  }
  preserve(event: ClaudeConversationEvent): boolean {
    if (event.emittedAtMs === undefined) {
      return false
    }
    if (event.hookEventName === 'UserPromptSubmit') {
      // It already created the retained turn. Re-publishing it would enqueue a continuation.
      return (
        this.appliedSubmissions.has(`${event.claudeSessionId}:${event.emittedAtMs}`) &&
        ((event.claudeSessionId === this.retained?.id && event.emittedAtMs <= this.retained.at) ||
          (this.activePrompt?.providerSessionId === event.claudeSessionId &&
            this.activePrompt?.promptId === event.promptId) ||
          this.coveredSubmissions.has(`${event.claudeSessionId}:${event.emittedAtMs}`))
      )
    }
    return (
      !!this.retained &&
      ['SessionStart', 'SessionEnd'].includes(event.hookEventName) &&
      event.emittedAtMs < this.retained.at
    )
  }
}

/** Preserve a turn already observed in the authenticated successor epoch. */
export function preserveClaudeProjection(
  entry: AgentRunEntry,
  event: ClaudeConversationEvent,
): boolean {
  if (!entry.model.snapshot.turn || !['SessionStart', 'SessionEnd'].includes(event.hookEventName)) {
    return false
  }
  const identity = entry.history.identity()
  const start = entry.claudeJournal?.view()
  return (
    identity.providerSessionId === start?.id &&
    !!entry.claudeJournal?.events.some(
      f =>
        f.kind === 'activity' &&
        !f.io &&
        f.id === identity.providerSessionId &&
        f.promptId === identity.promptId &&
        f.at >= (start?.startAt ?? Infinity) &&
        f.at > (event.emittedAtMs ?? Infinity),
    )
  )
}
