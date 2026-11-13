import { ClaudeJournalReceipts } from './ClaudeJournalReceipts'
import { ClaudeJournalHistory, CLAUDE_LIFECYCLE_LIMIT } from './ClaudeJournalHistory'
import { ClaudeJournalProof } from './ClaudeJournalProof'
import { ClaudeJournalLoss } from './ClaudeJournalLoss'
import type { AgentRunTurnEnd } from '../domain/agentRunState'
import type {
  ClaudeConversationEvent,
  ClaudeConversationCheckpoint,
} from '../../../shared/runtime/agentHook/claudeConversation'
import type { ClaudeTranscriptObservation } from '../../../shared/runtime/agentHook/claudeTranscript'
import { getClaudeTranscriptInput } from '../../../shared/runtime/agentHook/claudeTranscript'
import { ClaudeCaptureBindings, type ClaudeCaptureBinding } from './ClaudeCaptureBindings'
import {
  isClaudeClearEvidence,
  CLAUDE_CLEAR_QUIET_MS,
  CLAUDE_CLEAR_MAX_MS,
} from './ClaudeClearTransition'

type Request = NonNullable<ClaudeTranscriptObservation['conversation']>
export type JournalFact = {
  kind: 'start' | 'end' | 'activity' | 'finish' | 'complete'
  id: string
  at: number
  received: number
  promptId?: string
  capture?: ClaudeCaptureBinding
  input?: boolean
  io?: boolean
  order?: number
  clear?: boolean
  receipt?: AgentRunTurnEnd
  hookName?: string
  source?: string
  key: string
}
/** The only clear input-authority owner. Facts, capture bindings and explicit retirement
 * survive quiet settlement. Projection queues may be discarded; unresolved evidence may not. */
export class ClaudeInvocationJournal {
  private facts: JournalFact[] = []
  private requests: Request[] = []
  readonly bindings = new ClaudeCaptureBindings()
  private readonly loss = new ClaudeJournalLoss()
  private readonly history = new ClaudeJournalHistory()
  private readonly receipts = new ClaudeJournalReceipts()
  private lastFinish?: JournalFact
  private disposed = false
  private sequence = 0
  private enabledAt?: number
  constructor(private readonly now: () => number = Date.now) {}
  get enabled(): boolean {
    return this.enabledAt !== undefined
  }
  get events(): readonly JournalFact[] {
    return this.facts
  }
  capture(id?: string, at?: number): ClaudeCaptureBinding {
    return this.bindings.capture(id, at)
  }
  appendHook(event: ClaudeConversationEvent, request?: Request): boolean {
    if (this.disposed || (event.hookEventName === 'Notification' && event.state === null)) {
      return false
    }
    const name = event.hookEventName
    const firstClear = !this.enabled && isClaudeClearEvidence(event)
    if (isClaudeClearEvidence(event)) {
      this.enabledAt ??= this.now()
    }
    const at = event.emittedAtMs
    if (!Number.isFinite(at)) {
      if (isClaudeClearEvidence(event) || (this.enabled && event.state !== null)) {
        this.unknown(event.claudeSessionId)
      }
      return false
    }
    const id = event.claudeSessionId
    const current = this.current()
    if (firstClear && name === 'SessionStart' && at! <= (current?.at ?? -Infinity)) {
      this.unknown(id)
      return false
    }
    if (this.enabled && name !== 'SessionStart' && at! < (current?.at ?? -Infinity)) {
      return false
    }
    if (
      name === 'SessionStart' &&
      event.sessionStartSource !== 'clear' &&
      current?.id === id &&
      !this.ended(current)
    ) {
      return false
    }
    const kind =
      name === 'SessionStart'
        ? 'start'
        : name === 'SessionEnd'
          ? 'end'
          : ['Stop', 'StopFailure'].includes(name)
            ? 'finish'
            : event.state === 'working' || event.state === 'waiting'
              ? 'activity'
              : undefined
    if (!kind) {
      return false
    }
    const added = this.push({
      kind,
      hookName: name,
      id,
      at: at!,
      received: this.now(),
      promptId: event.promptId,
      clear: isClaudeClearEvidence(event),
      source: event.sessionStartSource,
      key: JSON.stringify([
        id,
        name,
        at,
        event.promptId,
        event.state,
        event.sessionStartSource,
        event.sessionEndReason,
      ]),
    })
    if (!added) {
      return false
    }
    if (kind === 'start') {
      this.bindings.start(id, at!, this.captures())
      for (const end of this.facts.filter(f => f.kind === 'end' && f.id === id)) {
        this.bindings.end(id, end.at, this.captures())
      }
    }
    if (kind === 'end') {
      this.bindings.end(id, at!, this.captures())
    }
    this.receipts.pair(new ClaudeJournalProof(this.facts), this.history)
    this.compactLifecycle()
    if (request && !this.enabled) {
      this.compactRequests()
      if (this.requests.length === 64) {
        this.loss.lose(this.requestFact(request), this.proof())
      } else {
        this.requests.push(request)
      }
    }
    return true
  }
  replayedSubmission(event: ClaudeConversationEvent): boolean {
    return (
      event.hookEventName === 'UserPromptSubmit' &&
      this.receipts.hasSubmission(event.claudeSessionId, event.emittedAtMs, event.promptId)
    )
  }
  takeRequests(): Request[] {
    const requests = this.requests
    this.requests = []
    return requests
  }
  attachment(initial?: ClaudeConversationCheckpoint): ClaudeConversationCheckpoint | undefined {
    return (
      initial && {
        ...initial,
        watermark: Math.max(
          initial.startAt ?? -Infinity,
          ...this.facts
            .filter(f => f.id === initial.current && !f.io && !f.input && f.kind !== 'complete')
            .map(f => f.at),
        ),
      }
    )
  }
  appendIO(record: ClaudeTranscriptObservation): boolean {
    if (this.disposed || !this.accepts(record.providerSessionId, record.conversationCapture)) {
      return false
    }
    const input = record.record
    const activity = record.activity?.state
    if (
      activity === 'idle' ||
      (!activity &&
        (!input ||
          getClaudeTranscriptInput(input) !== undefined ||
          !['user', 'invalid_user', 'queue'].includes(input.kind) ||
          (input.kind === 'invalid_user' && input.input === false) ||
          (input.kind === 'queue' && ['remove', 'dequeue'].includes(input.operation))))
    ) {
      return false
    }
    const capture = record.conversationCapture as ClaudeCaptureBinding | undefined
    return this.push({
      kind: 'activity',
      id: record.providerSessionId,
      at: record.activity?.observedAt ?? this.now(),
      received: this.now(),
      promptId: input?.kind === 'user' ? input.promptId : undefined,
      capture,
      io: true,
      input: !activity,
      key: `io:${capture?.serial}:${input?.kind === 'user' ? input.promptId : ''}:${record.providerSessionId}:${record.generation}:${record.fileIdentity}:${record.position}:${record.activity?.observedAt}:${activity ?? input?.kind}`,
    })
  }
  unknown(id = this.current()?.id ?? ''): void {
    this.push({
      kind: 'activity',
      id,
      at: this.now(),
      received: this.now(),
      input: true,
      capture: this.capture(id),
      key: `unknown:${id}:${this.now()}`,
    })
  }
  complete(
    id: string | undefined,
    promptId?: string,
    emittedAt?: number,
    receipt?: AgentRunTurnEnd | null,
  ): void {
    if (!id) {
      return
    }
    const finish = [...this.facts, ...(this.lastFinish ? [this.lastFinish] : [])].findLast(
      f =>
        f.kind === 'finish' &&
        f.id === id &&
        (promptId === undefined || f.promptId === promptId) &&
        (emittedAt === undefined || f.at === emittedAt),
    )
    if (finish) {
      const complete: JournalFact = {
        ...finish,
        receipt: receipt ?? undefined,
        kind: 'complete',
        key: `complete:${finish.key}`,
      }
      const pending = new ClaudeJournalProof([...this.facts, complete])
      this.receipts.pair(pending, this.history)
      if (
        !this.history.incomplete ||
        (pending.current && this.receipts.qualifies(complete, pending.current, this.history))
      ) {
        this.loss.resolve(complete, pending)
      }
      this.push(complete)
      this.compactRequests()
      this.compactCompleted()
      this.compactLifecycle()
    }
  }
  accepts(id: string | undefined, capture?: object): boolean {
    if (this.disposed) {
      return false
    }
    const binding = capture as ClaudeCaptureBinding | undefined
    if (
      binding &&
      (!this.bindings.owns(binding) || binding.retired || (binding.id && id && binding.id !== id))
    ) {
      return false
    }
    const latest = this.current()
    if (!latest || !id) {
      return true
    }
    const known = this.facts
      .filter(f => f.kind === 'start' && f.id === id)
      .sort((a, b) => a.at - b.at)
      .at(-1)
    return known
      ? known === latest && !this.ended(latest)
      : !this.history.knows(id) || (id === latest.id && !this.ended(latest))
  }
  acceptsCurrent(id: string | undefined, capture: object): boolean {
    const binding = capture as ClaudeCaptureBinding,
      current = this.current()
    return (
      this.accepts(id, capture) &&
      !!current &&
      binding.id === current.id &&
      binding.startAt === current.at
    )
  }
  private compactCompleted(): void {
    const proof = this.proof()
    this.facts = this.facts.filter(f => {
      if (['start', 'end'].includes(f.kind)) {
        return true
      }
      if (proof.retired(f) || proof.resolved(f)) {
        return false
      }
      return f.kind !== 'complete' || !proof.completion.some(stop => stop !== f && stop.at > f.at)
    })
  }
  private compactLifecycle(): void {
    const life = this.facts.filter(f => ['start', 'end'].includes(f.kind))
    if (life.length <= CLAUDE_LIFECYCLE_LIMIT) {
      return
    }
    this.history.truncate(this.sequence)
    const proof = this.proof()
    if (this.loss.blocked || proof.unresolved.length) {
      return
    }
    // With no pending obligations, completed bodies can be discarded before their witnesses.
    this.compactCompleted()
    const retired = life
      .filter(f => proof.retired(f))
      .slice(0, life.length - CLAUDE_LIFECYCLE_LIMIT)
    this.facts = this.facts.filter(f => !retired.includes(f))
  }
  private captures(): ClaudeCaptureBinding[] {
    return this.facts.flatMap(f => (f.capture ? [f.capture] : []))
  }
  private proof(facts = this.facts): ClaudeJournalProof {
    return new ClaudeJournalProof(
      facts,
      this.history.incomplete
        ? (stop, start) => this.receipts.qualifies(stop, start, this.history)
        : undefined,
    )
  }
  private current(): JournalFact | undefined {
    return this.proof().current
  }
  private ended(start: JournalFact): boolean {
    return this.facts.some(f => f.kind === 'end' && f.id === start.id && f.at >= start.at)
  }
  private requestFact(request: Request): JournalFact {
    const e = request.event
    return {
      kind:
        e.hookEventName === 'SessionStart'
          ? 'start'
          : e.hookEventName === 'SessionEnd'
            ? 'end'
            : ['Stop', 'StopFailure'].includes(e.hookEventName)
              ? 'finish'
              : 'activity',
      id: e.claudeSessionId,
      at: e.emittedAtMs!,
      received: 0,
      key: '',
      promptId: e.promptId,
    }
  }
  private compactRequests(): void {
    const proof = this.proof()
    this.requests = this.requests.filter(r => {
      const f = this.requestFact(r)
      return !proof.retired(f) && !proof.resolved(f)
    })
  }
  view(now = this.now()) {
    const proof = this.proof()
    const { current: start, ended, relevant, completion, unresolved, ambiguous } = proof
    const ordinary = !!start && !start.clear
    const reused = !!start && this.history.possiblyReused(start.id, start.at)
    const afterTruncation =
      !this.history.incomplete ||
      (!!start && completion.some(stop => this.receipts.qualifies(stop, start, this.history)))
    const first = this.enabledAt ?? now
    const quietAt = start
      ? Math.min(
          Math.max(
            start.received,
            ...relevant.filter(f => proof.epoch(f) === start).map(f => f.received),
          ) + CLAUDE_CLEAR_QUIET_MS,
          Math.max(first, start.received) + CLAUDE_CLEAR_MAX_MS,
        )
      : Infinity
    const quiet = completion.length > 0 || now >= quietAt
    const blocked =
      this.loss.blocked ||
      (this.history.incomplete && unresolved.length > 0) ||
      !afterTruncation ||
      ambiguous ||
      (reused && !completion.length) ||
      unresolved.some(f => {
        const corroborated =
          f.input &&
          f.promptId &&
          relevant.some(
            h =>
              h.hookName === 'UserPromptSubmit' &&
              h.promptId === f.promptId &&
              h.id === f.id &&
              proof.epoch(h) === start,
          )
        return !corroborated && (f.input || f.io || f.capture || proof.epoch(f) !== start)
      }) ||
      !start ||
      ended
    const ready =
      this.enabled &&
      !this.disposed &&
      !!start &&
      !ended &&
      !this.loss.blocked &&
      afterTruncation &&
      !ambiguous &&
      !unresolved.length &&
      (!(ordinary || reused) || completion.length > 0) &&
      quiet
    return {
      ready,
      blocked,
      historyIncomplete: this.history.incomplete,
      unresolved: this.loss.blocked || unresolved.length > 0,
      id: start?.id,
      startAt: start?.at,
      clear: !!start?.clear,
      quietAt,
      ended,
      clearEnded:
        ended && this.facts.some(f => f.kind === 'end' && f.clear && proof.epoch(f) === start),
      completed: completion.length > 0,
      receipt: completion.at(-1)?.receipt,
    }
  }
  private push(fact: JournalFact): boolean {
    if (this.facts.some(f => f.key === fact.key)) {
      return false
    }
    if (fact.order === undefined) {
      fact.order = this.receipts.observe(
        fact,
        ++this.sequence,
        this.history,
        new ClaudeJournalProof([...this.facts, fact]),
        this.enabled,
      )
    }
    if (fact.kind === 'finish') {
      this.lastFinish = fact
    }
    if (fact.kind === 'start') {
      this.history.remember(fact.id, fact.at, fact.order)
    }
    if (
      ['start', 'end'].includes(fact.kind) &&
      this.facts.filter(f => ['start', 'end'].includes(f.kind)).length >= CLAUDE_LIFECYCLE_LIMIT
    ) {
      this.history.truncate(fact.order)
    }
    if (this.facts.length === 128) {
      const proof = this.proof([...this.facts, fact])
      const disposable = proof.evictionIndex(this.facts, this.loss.blocked)
      if (disposable < 0) {
        if (fact.kind !== 'complete' && !proof.retired(fact) && !proof.resolved(fact)) {
          this.loss.lose(fact, proof)
        }
        return false
      }
      if (['start', 'end'].includes(this.facts[disposable].kind)) {
        this.history.truncate(this.sequence)
      }
      this.facts.splice(disposable, 1)
    }
    this.facts.push(fact)
    return true
  }
  dispose(): void {
    this.disposed = true
    this.bindings.dispose()
    this.loss.dispose()
    this.history.dispose()
    this.receipts.dispose()
    this.lastFinish = undefined
    this.requests = []
    this.facts = []
  }
}
