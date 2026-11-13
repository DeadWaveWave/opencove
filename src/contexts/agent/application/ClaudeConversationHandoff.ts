import type { ClaudeTranscriptObservation } from '../../../shared/runtime/agentHook/claudeTranscript'
import { getClaudeTranscriptInput } from '../../../shared/runtime/agentHook/claudeTranscript'
import type {
  ClaudeConversationCheckpoint,
  ClaudeConversationEvent,
} from '../../../shared/runtime/agentHook/claudeConversation'
import { isClaudeConversationActivity } from '../domain/ClaudeConversationLifecycle'
import type { AgentRunEntry } from './AgentRunStateEntry'

type Fact = { record: ClaudeTranscriptObservation; at: number; namespace?: number }
/** Annotation-only before the first clear: no classifier reads, publications or timers.
 * On handoff these facts join the existing bounded event-time owner, never a second reducer. */
export class ClaudeConversationHandoff {
  private facts: Fact[] = []
  private latestStarts = new Map<string, number>()
  private earliestStarts = new Map<string, number>()
  private qualifying = new Map<string, number>()
  note(event: ClaudeConversationEvent): void {
    if (
      !Number.isFinite(event.emittedAtMs) ||
      (!isClaudeConversationActivity(event) && event.hookEventName !== 'SessionStart')
    ) {
      return
    }
    if (event.hookEventName === 'SessionStart') {
      for (const fact of this.facts) {
        if (
          !fact.record.conversation &&
          fact.namespace === undefined &&
          fact.record.providerSessionId === event.claudeSessionId
        ) {
          fact.namespace = event.emittedAtMs
        }
      }
      this.latestStarts.set(
        event.claudeSessionId,
        Math.max(this.latestStarts.get(event.claudeSessionId) ?? -Infinity, event.emittedAtMs!),
      )
      if (this.latestStarts.size > 64) {
        this.latestStarts.delete(this.latestStarts.keys().next().value!)
      }
      this.earliestStarts.set(
        event.claudeSessionId,
        Math.min(this.earliestStarts.get(event.claudeSessionId) ?? Infinity, event.emittedAtMs!),
      )
      if (this.earliestStarts.size > 64) {
        this.earliestStarts.delete(this.earliestStarts.keys().next().value!)
        this.limited = true
      }
    }
    this.qualifying.set(
      event.claudeSessionId,
      Math.max(this.qualifying.get(event.claudeSessionId) ?? -Infinity, event.emittedAtMs!),
    )
    if (this.qualifying.size > 64) {
      this.qualifying.delete(this.qualifying.keys().next().value!)
    }
  }
  attachment(
    initial: ClaudeConversationCheckpoint | undefined,
  ): ClaudeConversationCheckpoint | undefined {
    return (
      initial && {
        ...initial,
        watermark: initial.current
          ? (this.qualifying.get(initial.current) ?? initial.startAt)
          : initial.watermark,
      }
    )
  }
  private limited = false
  private fileObservedAt = -Infinity
  private completedTurn?: string
  private completedOwner?: { id: string; at: number }
  private coveredSubmissions = new Set<string>()
  private appliedSubmissions = new Set<string>()
  private retained?: { id: string; at: number }
  observe(record: ClaudeTranscriptObservation, now: number): boolean {
    if (record.activity) {
      if (record.activity.observedAt < this.fileObservedAt) {
        return false
      }
      this.fileObservedAt = record.activity.observedAt
      if (record.activity.state === 'idle') {
        return false
      }
    }
    const event = record.conversation?.event
    if (event) {
      this.note(event)
    }
    if (
      event?.hookEventName === 'UserPromptSubmit' &&
      event.emittedAtMs! < (this.latestStarts.get(event.claudeSessionId) ?? -Infinity)
    ) {
      return false
    }
    if (event && !isClaudeConversationActivity(event)) {
      return false
    }
    if (!event && !record.activity && !this.isInput(record)) {
      return false
    }
    if (this.facts.length === 64) {
      this.facts.shift()
      this.limited = true
    }
    this.facts.push({
      record,
      namespace: this.latestStarts.get(record.providerSessionId),
      at: event?.emittedAtMs ?? record.activity?.observedAt ?? now,
    })
    return true
  }
  take(entry: AgentRunEntry, first: ClaudeConversationEvent): ClaudeTranscriptObservation[] {
    const original = entry.conversation?.providerSessionId
    const firstAt = first.emittedAtMs ?? -Infinity
    this.facts = this.facts.filter(
      f =>
        f.record.providerSessionId !== original ||
        (f.record.conversation !== undefined && f.at >= firstAt),
    )
    this.appliedSubmissions = new Set(
      this.facts
        .filter(f => f.record.conversation?.event.hookEventName === 'UserPromptSubmit')
        .map(f => `${f.record.providerSessionId}:${f.at}`),
    )
    const completed = this.facts.filter(f => {
      const e = f.record.conversation?.event
      return (
        e?.hookEventName === 'Stop' && entry.history.hasEndedPrompt(e.promptId, e.claudeSessionId)
      )
    })
    this.coveredSubmissions = new Set(
      this.facts
        .filter(
          f =>
            f.record.conversation?.event.hookEventName === 'UserPromptSubmit' &&
            completed.some(
              c => c.record.providerSessionId === f.record.providerSessionId && c.at >= f.at,
            ),
        )
        .map(f => `${f.record.providerSessionId}:${f.at}`),
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
    if (match) {
      this.retained = { id: match.record.providerSessionId, at: match.at }
      if (match.record.conversation?.event.hookEventName === 'Stop') {
        this.completedTurn = entry.model.snapshot.lastEndedTurn?.id
      }
    }
    return this.facts.filter(f => f.record.conversation).map(f => f.record)
  }
  historicalInput(record: ClaudeTranscriptObservation, startAt: number | undefined): boolean {
    return (
      record.record?.kind === 'user' &&
      this.facts.some(
        f =>
          f.record.providerSessionId === record.providerSessionId &&
          f.record.conversation?.event.hookEventName === 'UserPromptSubmit' &&
          f.record.conversation.event.promptId ===
            (record.record?.kind === 'user' ? record.record.promptId : undefined) &&
          f.at < (startAt ?? -Infinity) &&
          (f.namespace ?? -Infinity) < (startAt ?? -Infinity),
      )
    )
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
          this.coveredSubmissions.has(`${event.claudeSessionId}:${event.emittedAtMs}`))
      )
    }
    return (
      !!this.retained &&
      ['SessionStart', 'SessionEnd'].includes(event.hookEventName) &&
      event.emittedAtMs < this.retained.at
    )
  }
  establish(entry: AgentRunEntry, id: string): void {
    const owner = entry.conversation!
    for (const fact of this.facts) {
      const source = fact.record.providerSessionId
      if (
        source !== id &&
        !owner.retiredIdentities.has(source) &&
        fact.at > (owner.startedAt ?? Infinity) &&
        !fact.record.conversation
      ) {
        owner.suspend()
        owner.input.block(fact.at, `conversation:${source}`)
      }
      const lifecycle = fact.record.conversation?.event
      if (
        source === id &&
        lifecycle?.hookEventName === 'SessionEnd' &&
        lifecycle.sessionEndReason === 'clear' &&
        fact.at >= (owner.startedAt ?? Infinity)
      ) {
        owner.veto()
        owner.input.block(fact.at, `ended:${id}`)
      }
      if (
        source !== id ||
        fact.record.conversation ||
        (fact.record.activity && fact.at < (owner.startedAt ?? -Infinity)) ||
        (fact.namespace !== undefined && fact.namespace !== owner.startedAt)
      ) {
        continue
      }
      fact.namespace ??= owner.startedAt
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
            ['UserPromptSubmit', 'Stop'].includes(other.record.conversation.event.hookEventName) &&
            (promptId
              ? other.record.conversation.event.promptId === promptId &&
                (other.at >= (owner.startedAt ?? -Infinity) ||
                  (other.record.conversation.event.hookEventName === 'UserPromptSubmit' &&
                    (other.namespace ?? -Infinity) < (owner.startedAt ?? -Infinity)))
              : other.at >= fact.at),
        )
      ) {
        continue
      }
      owner.veto()
      owner.input.block(fact.at, promptId)
    }
    if (
      this.facts.some(
        f =>
          f.record.providerSessionId === id &&
          f.record.conversation?.event.hookEventName === 'SessionEnd' &&
          f.at < (owner.startedAt ?? -Infinity),
      )
    ) {
      owner.veto()
    }
    if (
      this.limited ||
      (this.earliestStarts.get(id) ?? Infinity) < (owner.startedAt ?? -Infinity)
    ) {
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
