import type { ClaudeConversationEvent } from '../../../shared/runtime/agentHook/claudeConversation'
import type { JournalFact } from './ClaudeInvocationJournal'
import {
  getClaudeTranscriptCompleted,
  getClaudeTranscriptInput,
} from '../../../shared/runtime/agentHook/claudeTranscript'
/** One proof vocabulary for admission and compaction. Missing identity alone is never retirement. */
export class ClaudeJournalProof {
  readonly current: JournalFact | undefined
  readonly completion: JournalFact[]
  readonly relevant: JournalFact[]
  readonly ended: boolean
  private starts = new Map<string, JournalFact[]>()
  private endings = new Map<string, JournalFact[]>()
  constructor(
    readonly facts: readonly JournalFact[],
    eligible?: (stop: JournalFact, start: JournalFact) => boolean,
  ) {
    for (const fact of facts) {
      if (fact.kind === 'start' || fact.kind === 'end') {
        const index = fact.kind === 'start' ? this.starts : this.endings
        index.set(fact.id, [...(index.get(fact.id) ?? []), fact])
      }
    }
    for (const named of this.starts.values()) {
      named.sort((a, b) => a.at - b.at)
    }
    this.current = facts.reduce<JournalFact | undefined>(
      (latest, f) => (f.kind === 'start' && (!latest || f.at >= latest.at) ? f : latest),
      undefined,
    )
    this.ended = !!this.current && this.ends(this.current).length > 0
    this.relevant = facts.filter(f => !this.retired(f))
    this.completion = this.current
      ? this.relevant.filter(
          f =>
            f.kind === 'complete' &&
            this.epoch(f) === this.current &&
            (!eligible || eligible(f, this.current!)),
        )
      : []
  }
  rejectsLifecycleReply(event: ClaudeConversationEvent): boolean {
    if (!['SessionStart', 'SessionEnd'].includes(event.hookEventName)) {
      return false
    }
    const current = this.current
    return (
      !current ||
      this.facts.some(f => f.kind === 'start' && f.at === current.at && f.id !== current.id) ||
      event.claudeSessionId !== current.id ||
      (event.hookEventName === 'SessionStart'
        ? event.emittedAtMs !== current.at
        : (event.emittedAtMs ?? -Infinity) < current.at)
    )
  }
  private ends(start: JournalFact): JournalFact[] {
    return (this.endings.get(start.id) ?? []).filter(f => f.at >= start.at)
  }
  epoch(f: JournalFact): JournalFact | undefined {
    const named = this.starts.get(f.id) ?? []
    if (f.capture?.startAt !== undefined) {
      return named.find(s => s.at === f.capture!.startAt)
    }
    const start = named.findLast(s => s.at <= f.at)
    // Untagged activity after End can belong to a delayed, same-ID successor Start.
    if (
      start &&
      ['activity', 'finish', 'complete'].includes(f.kind) &&
      this.ends(start).some(end => end.at < f.at)
    ) {
      return undefined
    }
    return start
  }
  retired(f: JournalFact): boolean {
    const epoch = this.epoch(f),
      current = this.current
    return (
      !!f.capture?.retired ||
      this.retiredAnonymousState(f) ||
      (!!current &&
        ((!f.io && !f.input && f.kind !== 'start' && f.at < current.at) ||
          (!!epoch && epoch.at < current.at) ||
          (!!epoch &&
            !['start', 'end'].includes(f.kind) &&
            this.ends(epoch).some(end => f.at <= end.at))))
    )
  }
  private retiredAnonymousState(f: JournalFact): boolean {
    if (!this.current || !this.anonymousState(f)) {
      return false
    }
    return this.facts.some(end => {
      if (end.kind !== 'end' || !end.clear) {
        return false
      }
      const previous = this.epoch(end)
      return (
        !!previous &&
        previous.at <= f.at &&
        f.at < end.at &&
        end.at < this.current!.at &&
        f.received < end.received
      )
    })
  }
  private anonymousState(f: JournalFact): boolean {
    return f.kind === 'activity' && !!f.io && !f.input && !f.id && !f.capture && !f.transcript
  }
  covers(stop: JournalFact, f: JournalFact): boolean {
    const anonymous =
      this.anonymousState(f) &&
      !!this.current &&
      this.current.at <= f.at &&
      this.current.received <= f.received
    return (
      !!this.current &&
      (this.epoch(f) === this.current || anonymous) &&
      this.epoch(stop) === this.current &&
      (stop.id === f.id || anonymous) &&
      (anonymous
        ? stop.at >= f.at && stop.order! > f.order!
        : f.kind !== 'finish' && f.io
          ? this.coversIO(stop, f)
          : stop.at >= f.at)
    )
  }
  private coversIO(stop: JournalFact, fact: JournalFact): boolean {
    const completed = fact.transcript && getClaudeTranscriptCompleted(fact.transcript)
    if (fact.transcript?.kind === 'assistant' && !fact.transcript.final) {
      return stop.order! >= fact.order! || (!!completed && completed === stop.promptId)
    }
    if (completed) {
      return completed === stop.promptId
    }
    if (fact.input) {
      return fact.promptId ? stop.promptId === fact.promptId : stop.order! >= fact.order!
    }
    return stop.at >= fact.at
  }
  resolved(f: JournalFact): boolean {
    return (
      ['activity', 'finish'].includes(f.kind) &&
      (this.auxiliary(f) || this.completion.some(stop => this.covers(stop, f)))
    )
  }
  auxiliary(f: JournalFact): boolean {
    return !!f.transcript && getClaudeTranscriptInput(f.transcript) === 'auxiliary'
  }
  get unresolved(): JournalFact[] {
    return this.relevant.filter(
      f =>
        (f.kind === 'end' && !this.epoch(f) && f.at > (this.current?.at ?? -Infinity)) ||
        (['activity', 'finish'].includes(f.kind) && !this.resolved(f)),
    )
  }
  get ambiguous(): boolean {
    const ordered = this.facts.filter(
      f =>
        !f.io &&
        !f.input &&
        f.kind !== 'complete' &&
        f.at >= (this.current?.at ?? Infinity) &&
        !this.completion.some(stop => f.kind !== 'start' && stop.id === f.id && stop.at > f.at),
    )
    return ordered.some((f, i) => ordered.slice(i + 1).some(other => other.at === f.at))
  }
  /** Remove obligations before their proof; keep current Start/End and latest completion. */
  evictionIndex(existing: readonly JournalFact[], lifecyclePinned: boolean): number {
    let index = existing.findIndex(
      f => !['start', 'end', 'complete'].includes(f.kind) && (this.retired(f) || this.resolved(f)),
    )
    if (index >= 0) {
      return index
    }
    index = existing.findIndex(
      f =>
        f.kind === 'complete' &&
        (this.retired(f) || this.completion.some(stop => stop !== f && stop.at > f.at)),
    )
    if (index >= 0) {
      return index
    }
    // S1/S2: pin all lifecycle witnesses while any retained or vetoed debt exists.
    if (lifecyclePinned || this.unresolved.length) {
      return -1
    }
    return existing.findIndex(f => ['start', 'end'].includes(f.kind) && this.retired(f))
  }
}
