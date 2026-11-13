import type { ClearEvent } from './cases'

export type CallbackCapture = { generation: number | undefined; epoch: number }
type Fact = ClearEvent & {
  received: number
  order: number
  namespace?: number
  late?: boolean
  capture?: CallbackCapture
}
/** Input-only specification. Epoch labels identify source captures, never SUT generations.
 * The opaque generation token belongs to the delivered callback, not the live run fence. */
export class ClearReference {
  private facts = new Map<string, Fact>()
  private hooks: Fact[] = []
  private starts = new Map<number, Fact>()
  private expired = new Set<number>()
  private pendingSince = new Map<number, number>()
  readonly retired = new Set<string>()
  now = 100000
  clearSeen = false
  private order = 0
  private firstClearOrder = Infinity
  authenticated = 0
  private relevantAt = -Infinity
  private captures = new Map<
    number,
    CallbackCapture & {
      authenticated: number
      target: string
      namespace?: number
    }
  >()
  private quietEpoch = -1
  private certified = new Set<number>()
  private uncertain = new Set<string>()
  private receiptBoundary = new Map<number, number>()
  private fileOrdinal = -Infinity
  private legacyReceipt = false
  private legacyActor = 'A'
  private legacyTurn?: { id: string; prompt: number; at: number }
  private legacyBoundary = -Infinity
  private legacyEnded = new Set<string>()
  private baselineStops = new Set<number>()
  private ordinaryActivity = new Map<string, number>()
  hasCapture(epoch: number): boolean {
    return this.captures.has(epoch)
  }
  private get authenticatedId(): string {
    return this.starts.get(this.authenticated)!.id
  }
  constructor() {
    this.starts.set(0, {
      epoch: 0,
      id: 'A',
      at: 10,
      kind: 'hook',
      name: 'SessionStart',
      received: this.now,
      order: 0,
    })
  }
  consume(event: ClearEvent, capture?: CallbackCapture): void {
    if (event.kind === 'tick') {
      this.advance(event.ms!)
      return
    }
    this.order++
    this.now = Math.max(this.now, 100000 + event.at)
    if (event.kind === 'capture') {
      if (capture && !this.captures.has(event.epoch)) {
        this.captures.set(event.epoch, {
          ...capture,
          authenticated: this.authenticated,
          target: event.id,
          namespace: event.id === this.authenticatedId ? this.authenticated : undefined,
        })
      }
      return
    }
    const fact: Fact = {
      late:
        this.clearSeen &&
        (this.quietEpoch === this.authenticated || this.certified.has(this.authenticated)),
      ...event,
      received: this.now,
      order: this.order,
      capture,
      namespace: event.id === this.authenticatedId ? this.authenticated : undefined,
    }
    if (!this.clearSeen) {
      this.observeLegacy(event)
    }
    if (event.kind === 'hook') {
      this.hooks.push(fact)
      if (event.name === 'SessionStart') {
        const before = this.starts.get(this.authenticated)!
        const duplicate = this.starts.get(event.epoch)?.at === event.at
        const watermark = Math.max(
          before.at,
          ...[...this.facts.values()]
            .filter(f => f.kind === 'hook' && f.id === before.id)
            .map(f => f.at),
        )
        const endedBefore = [...this.facts.values()].some(
          f =>
            f.kind === 'hook' &&
            f.id === event.id &&
            f.name === 'SessionEnd' &&
            f.at > before.at &&
            f.at < event.at,
        )
        const preclearConflict = this.hooks.some(
          h =>
            h.id === before.id &&
            h.namespace === this.authenticated &&
            h.order < this.firstClearOrder &&
            h.at >= event.at &&
            ['UserPromptSubmit', 'PermissionRequest', 'Stop', 'SessionEnd'].includes(h.name!),
        )
        if (
          !duplicate &&
          (!endedBefore || preclearConflict) &&
          event.id === before.id &&
          event.at >= before.at &&
          event.at <= watermark &&
          (!this.clearSeen || this.certified.has(this.authenticated) || preclearConflict)
        ) {
          this.uncertain.add(event.id)
        } else if (!duplicate && event.at > watermark) {
          this.uncertain.delete(event.id)
        }

        if (!this.starts.has(event.epoch)) {
          this.ordinaryActivity.delete(event.id)
        }
        this.starts.set(event.epoch, fact)
        if (event.at > this.starts.get(this.authenticated)!.at) {
          this.authenticated = event.epoch
        }
        for (const start of this.starts.values()) {
          if (
            start.at < this.starts.get(this.authenticated)!.at &&
            start.id !== this.authenticatedId
          ) {
            this.retired.add(start.id)
          }
        }
      }
      if (event.name === 'SessionEnd' || (event.name === 'SessionStart' && event.epoch > 0)) {
        if (!this.clearSeen) {
          for (const epoch of this.pendingSince.keys()) {
            this.pendingSince.set(epoch, this.now)
          }
        }
        this.firstClearOrder = Math.min(this.firstClearOrder, this.order)
        this.clearSeen = true
      }
    }
    for (const c of this.captures.values()) {
      if (c.target === this.authenticatedId && c.namespace === undefined) {
        c.namespace = this.authenticated
      }
    }
    for (const f of this.facts.values()) {
      if (f.kind !== 'hook' && f.namespace === undefined && f.id === this.authenticatedId) {
        f.namespace = this.authenticated
      }
    }
    // Captures from an older source epoch cannot cross a reused-ID transition.
    const origin = capture && this.captures.get(capture.epoch)
    const oldCapture =
      capture &&
      (!origin ||
        origin.generation !== capture.generation ||
        (origin.namespace !== undefined &&
          origin.namespace !== this.authenticated &&
          origin.target === event.id) ||
        (origin.authenticated !== this.authenticated &&
          (this.starts.get(origin.authenticated)!.id === event.id ||
            this.quietEpoch === this.authenticated ||
            this.certified.has(this.authenticated))))
    const sourceStart = this.starts.get(this.authenticated)!
    if (event.kind === 'hook' && event.id !== sourceStart.id && event.at < sourceStart.at) {
      this.retired.add(event.id)
    }
    const previousActivity = Math.max(
      -Infinity,
      ...[...this.facts.values()]
        .filter(
          f =>
            f.id === event.id &&
            f.kind === 'hook' &&
            ['UserPromptSubmit', 'PermissionRequest'].includes(f.name!),
        )
        .map(f => f.at),
    )
    const previousEnd = Math.max(
      -Infinity,
      ...[...this.facts.values()]
        .filter(f => f.id === event.id && f.name === 'Stop')
        .map(f => f.at),
    )
    const oldSubmit =
      event.kind === 'hook' &&
      event.name === 'UserPromptSubmit' &&
      (this.quietEpoch === this.authenticated || this.certified.has(this.authenticated)) &&
      event.at < previousActivity &&
      (previousActivity > previousEnd || this.ordinaryActivity.has(event.id))
    const stale =
      oldSubmit ||
      !!oldCapture ||
      (event.kind !== 'user' && event.at < this.starts.get(this.authenticated)!.at) ||
      (this.retired.has(event.id) && event.id !== this.authenticatedId)
    const boundary =
      event.id === this.authenticatedId ? this.receiptBoundary.get(this.authenticated) : undefined
    const staleFile =
      event.kind === 'file' &&
      (event.at <= this.fileOrdinal || 100000 + event.at < (boundary ?? -Infinity))
    if (!stale && !staleFile && event.kind === 'file') {
      this.fileOrdinal = event.at
    }
    const active =
      event.kind === 'user' ||
      (event.kind === 'file' && event.name !== 'idle') ||
      (event.kind === 'hook' && event.name !== 'Notification')
    if (
      !stale &&
      event.kind === 'hook' &&
      event.name === 'UserPromptSubmit' &&
      (this.quietEpoch === this.authenticated || this.certified.has(this.authenticated))
    ) {
      this.receiptBoundary.set(this.authenticated, this.now)
    }
    if (stale || staleFile || !active) {
      return
    }
    if (!this.starts.has(event.epoch)) {
      this.pendingSince.set(event.epoch, this.pendingSince.get(event.epoch) ?? this.now)
    }
    if (this.certified.has(this.authenticated) && event.id === this.authenticatedId) {
      const previousStop = [...this.facts.values()]
        .filter(f => f.id === event.id && f.name === 'Stop')
        .sort((a, b) => a.at - b.at)
        .at(-1)
      if (
        event.kind === 'hook' &&
        ['UserPromptSubmit', 'PermissionRequest'].includes(event.name!) &&
        (event.name !== 'UserPromptSubmit' ||
          event.at > (previousStop?.at ?? -Infinity) ||
          (this.baselineStops.has(this.authenticated) &&
            ![...this.facts.values()].some(
              f => f.kind === 'hook' && f.name === 'UserPromptSubmit' && f.epoch === event.epoch,
            )))
      ) {
        this.ordinaryActivity.set(
          event.id,
          Math.max(this.ordinaryActivity.get(event.id) ?? -Infinity, event.at),
        )
      } else if (
        event.kind === 'file' &&
        event.name !== 'idle' &&
        event.at > (previousStop?.at ?? -Infinity)
      ) {
        this.ordinaryActivity.set(event.id, event.at)
      } else if (
        event.name === 'Stop' &&
        event.at >= (this.ordinaryActivity.get(event.id) ?? -Infinity)
      ) {
        this.ordinaryActivity.delete(event.id)
      }
    }
    const key = `${event.kind}:${event.epoch}:${event.at}:${event.name ?? ''}`
    if (!this.facts.has(key)) {
      this.relevantAt = this.now
      this.facts.set(key, fact)
    }
    const newest = this.starts.get(this.authenticated)!
    for (const f of this.facts.values()) {
      if (f.kind === 'hook' && f.id !== newest.id && f.at < newest.at) {
        this.retired.add(f.id)
      }
    }
    if (
      this.verdict().receipt &&
      [...this.facts.values()].some(f => f.id === this.authenticatedId && f.name === 'Stop')
    ) {
      this.receiptBoundary.set(this.authenticated, this.now)
    }
    if (
      this.quietEpoch === this.authenticated &&
      this.verdict().receipt &&
      !this.verdict().completed
    ) {
      this.baselineStops.add(this.authenticated)
    }
    if (
      this.verdict().completed ||
      (this.quietEpoch === this.authenticated && this.verdict().receipt)
    ) {
      this.certified.add(this.authenticated)
    }
  }
  /** Before a clear, retain the legacy authenticated-hook receipt contract. No new
   * clear admission is inferred from file/transcript IO; exact compatibility is tested separately. */
  private observeLegacy(event: ClearEvent): void {
    if (event.kind !== 'hook') {
      return
    }
    if (event.name === 'PermissionRequest') {
      this.legacyReceipt = false
      this.legacyActor = event.id
    }
    if (
      event.name === 'UserPromptSubmit' &&
      !this.legacyEnded.has(`${event.id}:${event.epoch}`) &&
      100000 + event.at >= this.legacyBoundary
    ) {
      this.legacyReceipt = false
      this.legacyActor = event.id
      this.legacyTurn ??= { id: event.id, prompt: event.epoch, at: 100000 + event.at }
    }
    if (event.name === 'Stop') {
      this.legacyReceipt = true
      this.legacyActor = event.id
      if (this.legacyTurn) {
        this.legacyEnded.add(`${this.legacyTurn.id}:${this.legacyTurn.prompt}`)
      }
      this.legacyEnded.add(`${event.id}:${event.epoch}`)
      this.legacyTurn = undefined
      this.legacyBoundary = Math.max(this.legacyBoundary, 100000 + event.at)
    }
  }
  advance(ms: number): void {
    this.now += ms
    if (!this.clearSeen) {
      return
    }
    if (this.now - this.relevantAt >= 200) {
      this.quietEpoch = this.authenticated
      if (this.verdict().receipt) {
        this.certified.add(this.authenticated)
        if (!this.verdict().completed) {
          this.baselineStops.add(this.authenticated)
        }
      }
    }
    for (const [epoch, since] of this.pendingSince) {
      if (!this.starts.has(epoch) && this.now - since >= 2000) {
        this.expired.add(epoch)
      }
    }
  }
  verdict() {
    const authenticatedStart = this.starts.get(this.authenticated)!
    const pending = [...this.facts.values()]
      .filter(
        f =>
          f.id !== authenticatedStart.id &&
          !this.retired.has(f.id) &&
          (f.kind === 'user'
            ? f.received > 100000 + authenticatedStart.at
            : f.at > authenticatedStart.at),
      )
      .sort((a, b) => a.at - b.at)
      .at(-1)
    const epoch = pending?.epoch ?? this.authenticated,
      id = pending?.id ?? authenticatedStart.id
    const start = this.starts.get(epoch)
    const facts = [...this.facts.values()].filter(
      f =>
        f.id === id &&
        (f.kind === 'user'
          ? f.namespace === undefined || f.namespace === epoch
          : f.at >= (start?.at ?? -Infinity)),
    )
    const hooks = facts
      .filter(f => f.kind === 'hook' && !['SessionStart', 'Notification'].includes(f.name!))
      .sort((a, b) => a.at - b.at)
    const last = hooks.at(-1)
    const submit = hooks.findLast(f => f.name === 'UserPromptSubmit')
    const stop =
      last?.name === 'Stop' &&
      (!submit ||
        hooks.some(h => h.name === 'Stop' && h.epoch === submit.epoch && h.at > submit.at))
    const input =
      facts.some(
        f =>
          (f.kind === 'file' && f.name !== 'idle' && (!stop || f.at > last!.at)) ||
          (f.kind === 'user' &&
            !this.legacyEnded.has(`${f.id}:${f.epoch}`) &&
            !this.hooks.some(
              h =>
                h.id === id &&
                h.epoch === f.epoch &&
                h.name === 'UserPromptSubmit' &&
                (h.order < (start?.order ?? Infinity) ||
                  (!h.late &&
                    [...this.starts.values()].some(
                      s => s.id === id && s.at <= h.at && s.at < (start?.at ?? -Infinity),
                    ))) &&
                h.at < (start?.at ?? -Infinity),
            ) &&
            !hooks.some(
              h => h.epoch === f.epoch && ['UserPromptSubmit', 'Stop'].includes(h.name!),
            )),
      ) || this.ordinaryActivity.has(id)
    const reused =
      [...this.starts.values()].some(f => f.at < (start?.at ?? -Infinity) && f.id === id) ||
      [...this.facts.values()].some(
        f => f.id === id && f.name === 'SessionEnd' && f.at < (start?.at ?? -Infinity),
      )
    const clear = !!start && epoch > 0 && !reused && !hooks.length && !input
    const ended = hooks.some(f => f.name === 'SessionEnd')
    const clearReceipt =
      !!start &&
      !(
        reused &&
        last?.namespace !== undefined &&
        last.namespace !== epoch &&
        last.order < this.firstClearOrder
      ) &&
      !ended &&
      !input &&
      !this.uncertain.has(id) &&
      ((clear && !this.expired.has(epoch)) || !!stop)
    const receipt = this.clearSeen ? clearReceipt : this.legacyReceipt
    return {
      id: this.clearSeen ? id : this.legacyActor,
      epoch,
      receipt,
      clearAllowed: clear,
      completed:
        !!submit &&
        !!start &&
        hooks.some(
          h =>
            h.name === 'Stop' &&
            h.epoch === submit.epoch &&
            h.at > submit.at &&
            !hooks.some(e => e.name === 'SessionEnd' && e.at < h.at),
        ),
      due: this.clearSeen && receipt && this.now - this.relevantAt >= 200,
      unresolved: !receipt,
      retired: [...this.retired],
      latestAuthenticated: this.authenticatedId,
    }
  }
}
