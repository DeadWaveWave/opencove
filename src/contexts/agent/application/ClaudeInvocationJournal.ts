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
  private overflow = false
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
      this.bindings.start(id, at!)
      for (const end of this.facts.filter(f => f.kind === 'end' && f.id === id)) {
        this.bindings.end(id, end.at)
      }
    }
    if (kind === 'end') {
      this.bindings.end(id, at!)
    }
    if (request && !this.enabled) {
      if (this.requests.length === 64) {
        this.requests.shift()
        this.overflow = true
      }
      this.requests.push(request)
    }
    return true
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
    const finish = this.facts.findLast(
      f =>
        f.kind === 'finish' &&
        f.id === id &&
        (promptId === undefined || f.promptId === promptId) &&
        (emittedAt === undefined || f.at === emittedAt),
    )
    if (finish) {
      this.push({
        ...finish,
        receipt: receipt ?? undefined,
        kind: 'complete',
        key: `complete:${finish.key}`,
      })
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
    return !known || (known === latest && !this.ended(latest))
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
  private current(): JournalFact | undefined {
    return this.facts
      .filter(f => f.kind === 'start')
      .sort((a, b) => a.at - b.at)
      .at(-1)
  }
  private epoch(fact: JournalFact): JournalFact | undefined {
    if (fact.capture?.startAt !== undefined) {
      return this.facts.find(
        f => f.kind === 'start' && f.id === fact.id && f.at === fact.capture!.startAt,
      )
    }
    return this.facts
      .filter(f => f.kind === 'start' && f.id === fact.id && f.at <= fact.at)
      .sort((a, b) => a.at - b.at)
      .at(-1)
  }
  private ended(start: JournalFact): boolean {
    return this.facts.some(f => f.kind === 'end' && f.id === start.id && f.at >= start.at)
  }
  view(now = this.now()) {
    const start = this.current()
    const ended = !!start && this.ended(start)
    const retired = (f: JournalFact) =>
      !!f.capture?.retired ||
      (!f.io && !f.input && f.kind !== 'start' && f.at < (start?.at ?? -Infinity)) ||
      (this.epoch(f) !== undefined && this.epoch(f) !== start) ||
      (this.epoch(f) === start && ended)
    const relevant = this.facts.filter(f => !retired(f))
    const completion = relevant.filter(f => f.kind === 'complete' && this.epoch(f) === start)
    const unresolved = relevant.filter(
      f =>
        (f.kind === 'end' && !this.epoch(f) && f.at > (start?.at ?? -Infinity)) ||
        (['activity', 'finish'].includes(f.kind) &&
          !completion.some(
            stop =>
              this.epoch(f) === start &&
              stop.id === f.id &&
              (f.kind === 'finish'
                ? stop.at >= f.at
                : f.io
                  ? f.input
                    ? f.promptId
                      ? stop.promptId === f.promptId
                      : stop.order! >= f.order!
                    : stop.at >= f.at
                  : stop.at >= f.at),
          )),
    )
    const ordered = this.facts.filter(
      f =>
        !f.io &&
        !f.input &&
        f.kind !== 'complete' &&
        f.at >= (start?.at ?? Infinity) &&
        !completion.some(stop => f.kind !== 'start' && stop.id === f.id && stop.at > f.at),
    )
    const ambiguous = ordered.some((f, i) => ordered.slice(i + 1).some(other => other.at === f.at))
    const ordinary = !!start && !start.clear
    const reused =
      !!start && this.facts.some(f => f.kind === 'start' && f.id === start.id && f.at < start.at)
    const first = this.enabledAt ?? now
    const quietAt = start
      ? Math.min(
          Math.max(
            start.received,
            ...relevant.filter(f => this.epoch(f) === start).map(f => f.received),
          ) + CLAUDE_CLEAR_QUIET_MS,
          Math.max(first, start.received) + CLAUDE_CLEAR_MAX_MS,
        )
      : Infinity
    const quiet = completion.length > 0 || now >= quietAt
    const blocked =
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
              this.epoch(h) === start,
          )
        return !corroborated && (f.input || f.io || f.capture || this.epoch(f) !== start)
      }) ||
      !start ||
      ended
    const ready =
      this.enabled &&
      !this.disposed &&
      !!start &&
      !ended &&
      !this.overflow &&
      !ambiguous &&
      !this.bindings.limited &&
      !unresolved.length &&
      (!(ordinary || reused) || completion.length > 0) &&
      quiet
    return {
      ready,
      blocked,
      unresolved: unresolved.length > 0,
      id: start?.id,
      startAt: start?.at,
      clear: !!start?.clear,
      quietAt,
      ended,
      clearEnded:
        ended && this.facts.some(f => f.kind === 'end' && f.clear && this.epoch(f) === start),
      completed: completion.length > 0,
      receipt: completion.at(-1)?.receipt,
    }
  }
  private push(fact: JournalFact): boolean {
    if (this.facts.some(f => f.key === fact.key)) {
      return false
    }
    if (this.facts.length === 128) {
      const current = this.current()
      const retired = this.facts.findIndex(f => f.kind !== 'start' && this.epoch(f) !== current)
      if (retired >= 0) {
        this.facts.splice(retired, 1)
      } else {
        this.facts.shift()
        this.overflow = true
      }
    }
    fact.order ??= ++this.sequence
    this.facts.push(fact)
    return true
  }
  limit(): void {
    this.overflow = true
  }
  dispose(): void {
    this.disposed = true
    this.bindings.dispose()
    this.requests = []
    this.facts = []
  }
}
