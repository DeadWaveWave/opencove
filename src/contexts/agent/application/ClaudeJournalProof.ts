import type { JournalFact } from './ClaudeInvocationJournal'
/** One proof vocabulary for admission and compaction. Missing identity is never retirement. */
export class ClaudeJournalProof {
  readonly current: JournalFact | undefined
  readonly completion: JournalFact[]
  readonly relevant: JournalFact[]
  readonly ended: boolean
  constructor(readonly facts: readonly JournalFact[]) {
    this.current = facts
      .filter(f => f.kind === 'start')
      .sort((a, b) => a.at - b.at)
      .at(-1)
    this.ended = !!this.current && this.ends(this.current).length > 0
    this.relevant = facts.filter(f => !this.retired(f))
    this.completion = this.current
      ? this.relevant.filter(f => f.kind === 'complete' && this.epoch(f) === this.current)
      : []
  }
  private ends(start: JournalFact): JournalFact[] {
    return this.facts.filter(f => f.kind === 'end' && f.id === start.id && f.at >= start.at)
  }
  epoch(f: JournalFact): JournalFact | undefined {
    if (f.capture?.startAt !== undefined)
      return this.facts.find(
        s => s.kind === 'start' && s.id === f.id && s.at === f.capture!.startAt,
      )
    const start = this.facts
      .filter(s => s.kind === 'start' && s.id === f.id && s.at <= f.at)
      .sort((a, b) => a.at - b.at)
      .at(-1)
    // Untagged activity after End can belong to a delayed, same-ID successor Start.
    if (
      start &&
      ['activity', 'finish', 'complete'].includes(f.kind) &&
      this.ends(start).some(end => end.at < f.at)
    )
      return undefined
    return start
  }
  retired(f: JournalFact): boolean {
    const epoch = this.epoch(f),
      current = this.current
    return (
      !!f.capture?.retired ||
      (!!current &&
        ((!f.io && !f.input && f.kind !== 'start' && f.at < current.at) ||
          (!!epoch && epoch.at < current.at) ||
          (!!epoch &&
            !['start', 'end'].includes(f.kind) &&
            this.ends(epoch).some(end => f.at <= end.at))))
    )
  }
  covers(stop: JournalFact, f: JournalFact): boolean {
    return (
      !!this.current &&
      this.epoch(f) === this.current &&
      this.epoch(stop) === this.current &&
      stop.id === f.id &&
      (f.kind === 'finish'
        ? stop.at >= f.at
        : f.io
          ? f.input
            ? f.promptId
              ? stop.promptId === f.promptId
              : stop.order! >= f.order!
            : stop.at >= f.at
          : stop.at >= f.at)
    )
  }
  resolved(f: JournalFact): boolean {
    return (
      ['activity', 'finish'].includes(f.kind) && this.completion.some(stop => this.covers(stop, f))
    )
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
  evictionIndex(existing: readonly JournalFact[]): number {
    let index = existing.findIndex(
      f => !['start', 'end', 'complete'].includes(f.kind) && (this.retired(f) || this.resolved(f)),
    )
    if (index >= 0) return index
    index = existing.findIndex(
      f =>
        f.kind === 'complete' &&
        (this.retired(f) || this.completion.some(stop => stop !== f && stop.at > f.at)),
    )
    if (index >= 0) return index
    index = existing.findIndex(f => f.kind === 'end' && this.retired(f))
    if (index >= 0) return index
    return existing.findIndex(
      f =>
        f.kind === 'start' &&
        this.retired(f) &&
        !this.facts.some(other => other !== f && this.epoch(other) === f),
    )
  }
}
