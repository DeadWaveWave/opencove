import { ClaudeJournalReceipts, claudeHookKey, isClaudeReceipt } from './ClaudeJournalReceipts'
import {
  ClaudeJournalHistory,
  CLAUDE_LIFECYCLE_LIMIT,
  CLAUDE_FACT_LIMIT,
} from './ClaudeJournalHistory'
import { boundedInsert } from '../../../shared/utils/boundedInsert'
import { ClaudeJournalProof } from './ClaudeJournalProof'
import { ClaudeJournalLoss } from './ClaudeJournalLoss'
import type { AgentRunTurnEnd } from '../domain/agentRunState'
import type {
  ClaudeConversationEvent,
  ClaudeConversationCheckpoint,
} from '../../../shared/runtime/agentHook/claudeConversation'
import type { ClaudeTranscriptObservation } from '../../../shared/runtime/agentHook/claudeTranscript'
import {
  getClaudeTranscriptInput,
  getClaudeTranscriptPrompt,
} from '../../../shared/runtime/agentHook/claudeTranscript'
import { ClaudeCaptureBindings, type ClaudeCaptureBinding } from './ClaudeCaptureBindings'
import {
  isClaudeClearEvidence,
  CLAUDE_CLEAR_QUIET_MS,
  CLAUDE_CLEAR_MAX_MS,
} from './ClaudeClearTransition'

import { claudeRequestFact, type JournalFact } from './ClaudeJournalFact'
export type { JournalFact } from './ClaudeJournalFact'

type Request = NonNullable<ClaudeTranscriptObservation['conversation']>
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
  get saturated(): boolean {
    return this.enabled && this.history.incomplete
  }
  get events(): readonly JournalFact[] {
    return this.facts
  }
  saturate(): void {
    this.history.truncate()
  }
  capture(id?: string, at?: number): ClaudeCaptureBinding {
    return this.bindings.capture(id, at)
  }
  appendHook(event: ClaudeConversationEvent, request?: Request, establish = false): boolean {
    if (this.disposed || (event.hookEventName === 'Notification' && event.state === null)) {
      return false
    }
    this.observeReceipt(event)
    const name = event.hookEventName
    const firstClear = !this.enabled && isClaudeClearEvidence(event)
    if (firstClear && Number.isFinite(event.emittedAtMs)) {
      this.receipts.beginClear(event.emittedAtMs!)
    }
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
      !establish &&
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
      key: claudeHookKey(event),
    })
    if (!added) {
      return false
    }
    if (kind === 'start') {
      this.receipts.bind(id, at!)
      this.bindings.start(id, at!, this.captures())
      for (const end of this.facts.filter(f => f.kind === 'end' && f.id === id)) {
        this.bindings.end(id, end.at, this.captures())
      }
    }
    if (kind === 'end') {
      this.bindings.end(id, at!, this.captures())
    }
    if (request && !this.enabled) {
      this.compactRequests()
      boundedInsert(
        this.requests.length,
        64,
        () => this.requests.push(request),
        () => this.loss.lose(claudeRequestFact(request), this.proof()),
      )
    }
    return true
  }
  /** Capture immutable provenance before any classifier or timestamp discard. */
  observeReceipt(event: ClaudeConversationEvent): boolean {
    if (this.disposed || !isClaudeReceipt(event)) {
      return false
    }
    const key = claudeHookKey(event)
    if (this.receipts.order(key) !== undefined) {
      return true
    }
    const fact: JournalFact = {
      kind: event.hookEventName === 'UserPromptSubmit' ? 'activity' : 'finish',
      id: event.claudeSessionId,
      at: event.emittedAtMs ?? NaN,
      received: this.now(),
      key,
    }
    const proof = new ClaudeJournalProof([...this.facts, fact]),
      epoch = proof.epoch(fact)
    const namespace = epoch
      ? epoch.at
      : !epoch &&
          ((proof.current?.id === fact.id && proof.ended) ||
            ((!this.history.knows(fact.id) ||
              this.facts.some(f => f.id === fact.id && f.kind === 'start' && f.at > fact.at)) &&
              !this.facts.some(f => f.id === fact.id && f.kind === 'end' && f.at < fact.at))) &&
          Number.isFinite(fact.at)
        ? 'pending'
        : 'rejected'
    this.receipts.observe(fact, ++this.sequence, this.history, namespace, !this.enabled)
    return false
  }
  rejectsReceipt(event: ClaudeConversationEvent): boolean {
    return (
      isClaudeReceipt(event) && !this.receipts.belongs(claudeHookKey(event), this.current()?.at)
    )
  }
  claimReceipt(event: ClaudeConversationEvent, namespace: number | undefined): boolean {
    return !isClaudeReceipt(event) || this.receipts.claim(claudeHookKey(event), namespace)
  }
  rejectsLifecycleReply(event: ClaudeConversationEvent): boolean {
    return this.proof().rejectsLifecycleReply(event)
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
    if (
      this.disposed ||
      record.auxiliary ||
      !this.accepts(record.providerSessionId, record.conversationCapture)
    ) {
      return false
    }
    const input = record.record
    const activity = record.activity?.state
    if (
      activity === 'idle' ||
      (!activity &&
        (!input ||
          getClaudeTranscriptInput(input) !== undefined ||
          !['user', 'invalid_user', 'queue', 'assistant'].includes(input.kind) ||
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
      promptId:
        input && (input.kind === 'user' || input.kind === 'assistant')
          ? (('promptId' in input ? input.promptId : undefined) ?? getClaudeTranscriptPrompt(input))
          : undefined,
      capture,
      io: true,
      transcript: input,
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
      this.loss.resolve(complete, this.proof([...this.facts, complete]))
      this.push(complete)
      this.compactRequests()
      this.compactCompleted()
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
  private captures(): ClaudeCaptureBinding[] {
    return this.facts.flatMap(f => (f.capture ? [f.capture] : []))
  }
  private proof(facts = this.facts): ClaudeJournalProof {
    return new ClaudeJournalProof(facts, (stop, start) => this.receipts.belongs(stop.key, start.at))
  }
  private current(): JournalFact | undefined {
    return this.proof().current
  }
  private ended(start: JournalFact): boolean {
    return this.facts.some(f => f.kind === 'end' && f.id === start.id && f.at >= start.at)
  }
  private compactRequests(): void {
    const proof = this.proof()
    this.requests = this.requests.filter(r => {
      const f = claudeRequestFact(r)
      return !proof.retired(f) && !proof.resolved(f)
    })
  }
  view(now = this.now()) {
    const proof = this.proof()
    const { current: start, ended, relevant, completion, unresolved, ambiguous } = proof
    const ordinary = !!start && !start.clear
    const reused = !!start && this.history.possiblyReused(start.id, start.at)
    const first = this.enabledAt ?? now
    const quietAt = start
      ? Math.min(
          Math.max(
            start.received,
            ...relevant
              .filter(f => proof.epoch(f) === start && !proof.auxiliary(f))
              .map(f => f.received),
          ) + CLAUDE_CLEAR_QUIET_MS,
          Math.max(first, start.received) + CLAUDE_CLEAR_MAX_MS,
        )
      : Infinity
    const quiet = completion.length > 0 || now >= quietAt
    const blocked =
      this.loss.blocked ||
      this.history.incomplete ||
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
      !this.history.incomplete &&
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
      fact.order =
        fact.kind === 'finish' || fact.hookName === 'UserPromptSubmit'
          ? (this.receipts.order(fact.key) ?? 0)
          : ++this.sequence
    }
    if (fact.kind === 'finish') {
      this.lastFinish = fact
    }
    if (fact.kind === 'start') {
      this.history.remember(fact.id, fact.at)
    }
    if (['start', 'end'].includes(fact.kind)) {
      let size = this.facts.filter(f => ['start', 'end'].includes(f.kind)).length
      if (size >= CLAUDE_LIFECYCLE_LIMIT) {
        this.history.truncate()
        const proof = this.proof([...this.facts, fact])
        if (!this.loss.blocked && !proof.unresolved.length) {
          const retired = this.facts.findIndex(
            f => ['start', 'end'].includes(f.kind) && proof.retired(f),
          )
          if (retired >= 0) {
            this.facts.splice(retired, 1)
            size--
          }
        }
      }
      if (
        !boundedInsert(
          size,
          CLAUDE_LIFECYCLE_LIMIT,
          () => {},
          () => this.history.truncate(),
        )
      ) {
        return false
      }
    }
    if (this.facts.length === CLAUDE_FACT_LIMIT) {
      const proof = this.proof([...this.facts, fact])
      const disposable = proof.evictionIndex(this.facts, this.loss.blocked)
      if (disposable < 0) {
        if (fact.kind !== 'complete' && !proof.retired(fact) && !proof.resolved(fact)) {
          this.loss.lose(fact, proof)
        }
        return false
      }
      if (['start', 'end'].includes(this.facts[disposable].kind)) {
        this.history.truncate()
      }
      this.facts.splice(disposable, 1)
    }
    return boundedInsert(
      this.facts.length,
      CLAUDE_FACT_LIMIT,
      () => this.facts.push(fact),
      () => this.loss.lose(fact, this.proof()),
    )
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
