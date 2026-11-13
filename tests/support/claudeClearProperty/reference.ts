import type { ClearEvent } from './cases'
export type CallbackCapture = { generation: number | undefined; epoch: number }
type Source = { target: string; start?: number; generation: number | undefined }
type Fact = ClearEvent & {
  received: number
  order: number
  firstOrder: number
  observedNamespace?: number
  capture?: Source
  afterCommit?: boolean
}
/** Independent input model. Retirement uses authenticated lifecycle only; neither quiet
 * nor an implementation generation can invalidate a source capability. */
export class ClearReference {
  private facts: Fact[] = []
  private starts: Fact[] = []
  private namespaces = new Map<string, Fact[]>()
  private latest!: Fact
  private lifecycle = new Set(['SessionStart:A:10'])
  private identities = new Set(['A'])
  private truncatedAt?: number
  private sources = new Map<number, Source>()
  private provenance = new Set<Fact>()
  private pairings = new Map<Fact, { start: number; submit: Fact }>()
  private pairedSubmits = new Set<Fact>()
  private order = 0
  private settled = new Set<number>()
  private legacyReceipt = false
  private legacyActor = 'A'
  private legacyEnded = new Set<string>()
  private legacyPrompt?: { id: string; epoch: number }
  private states = new Map<number, { name: string; at: number }>()
  readonly retired = new Set<string>()
  now = 100000
  clearSeen = false
  constructor() {
    this.starts.push({
      epoch: 0,
      id: 'A',
      kind: 'hook',
      name: 'SessionStart',
      at: 10,
      received: this.now,
      order: 0,
      firstOrder: 0,
    })
    this.latest = this.starts[0]
    this.namespaces.set('A', [this.latest])
  }
  hasCapture(epoch: number): boolean {
    return this.sources.has(epoch)
  }
  private current(): Fact {
    return this.latest
  }
  private epoch(f: Fact): Fact | undefined {
    const candidates = this.namespaces.get(f.id) ?? []
    if (f.capture?.start !== undefined) {
      return candidates.find(s => s.at === f.capture!.start)
    }
    const start = candidates.filter(s => s.at <= f.at).at(-1)
    // End is negative namespace evidence: a later untagged hook may be a successor.
    if (
      start &&
      f.kind === 'hook' &&
      !['SessionStart', 'SessionEnd'].includes(f.name!) &&
      this.facts.some(
        e =>
          e.kind === 'hook' &&
          e.name === 'SessionEnd' &&
          e.id === f.id &&
          e.at >= start.at &&
          e.at < f.at,
      )
    ) {
      return undefined
    }
    return start
  }
  private ended(s: Fact): boolean {
    return this.facts.some(
      f => f.kind === 'hook' && f.name === 'SessionEnd' && f.id === s.id && f.at >= s.at,
    )
  }
  private retiredSource(source: Source): boolean {
    if (source.start === undefined) {
      return false
    }
    const start = (this.namespaces.get(source.target) ?? []).find(s => s.at === source.start)
    return !!start && (start.at < this.current().at || this.ended(start))
  }
  consume(event: ClearEvent, capture?: CallbackCapture): void {
    if (event.kind === 'tick') {
      this.advance(event.ms!)
      return
    }
    this.now = Math.max(this.now, 100000 + event.at)
    this.order++
    if (event.kind === 'capture') {
      if (capture && !this.sources.has(capture.epoch)) {
        this.sources.set(capture.epoch, {
          target: event.id,
          start: this.namespaces.get(event.id)?.at(-1)?.at,
          generation: capture.generation,
        })
      }
      return
    }
    const current = this.current(),
      source = capture && this.sources.get(capture.epoch)
    if (
      capture &&
      (!source || source.generation !== capture.generation || this.retiredSource(source))
    ) {
      return
    }
    if (!this.clearSeen && event.kind === 'hook') {
      if (
        event.name === 'UserPromptSubmit' &&
        !this.legacyEnded.has(`${event.id}:${event.epoch}`)
      ) {
        this.legacyReceipt = false
        this.legacyActor = event.id
        this.legacyPrompt ??= { id: event.id, epoch: event.epoch }
      }
      if (event.name === 'PermissionRequest') {
        this.legacyReceipt = false
        this.legacyActor = event.id
      }
      if (event.name === 'Stop') {
        this.legacyReceipt = true
        this.legacyActor = event.id
        this.legacyEnded.add(`${event.id}:${event.epoch}`)
        if (this.legacyPrompt) {
          this.legacyEnded.add(`${this.legacyPrompt.id}:${this.legacyPrompt.epoch}`)
        }
        this.legacyPrompt = undefined
      }
    }
    const fact: Fact = {
      ...event,
      received: this.now,
      order: this.order,
      firstOrder: this.order,
      capture: source,
      observedNamespace:
        event.kind === 'hook' && this.clearSeen ? this.epoch({ ...event } as Fact)?.at : undefined,
    }
    if (event.kind === 'hook' && event.name === 'SessionStart') {
      if (!this.starts.some(s => s.id === event.id && s.at === event.at)) {
        this.starts.push(fact)
        const named = [...(this.namespaces.get(event.id) ?? []), fact].sort((a, b) => a.at - b.at)
        this.namespaces.set(event.id, named)
        if (fact.at >= this.latest.at) {
          this.latest = fact
        }
        for (const c of this.sources.values()) {
          if (c.target === event.id && c.start === undefined) {
            c.start = event.at
          }
        }
      }
    }
    if (
      event.kind === 'hook' &&
      (event.name === 'SessionEnd' || (event.name === 'SessionStart' && event.epoch > 0))
    ) {
      this.clearSeen = true
    }
    if (event.kind === 'hook' && ['SessionStart', 'SessionEnd'].includes(event.name!)) {
      this.lifecycle.add(`${event.name}:${event.id}:${event.at}`)
      if (event.name === 'SessionStart') {
        this.identities.add(event.id)
      }
      // Published budgets, evaluated from events only; no production retention state.
      if (this.lifecycle.size > 64 || this.identities.size > 128) {
        this.truncatedAt ??= this.order
      }
    }
    if (
      event.kind === 'metadata' ||
      (event.kind === 'file' && event.name === 'idle') ||
      event.name === 'Notification'
    ) {
      return
    }
    const latest = this.current()
    for (const s of this.starts) {
      if (s.at < latest.at && s.id !== latest.id) {
        this.retired.add(s.id)
      }
    }
    if (event.kind === 'hook' && event.name !== 'SessionStart' && event.at < latest.at) {
      return
    }
    const processing = this.states.get(latest.at)
    if (
      this.settled.has(latest.at) &&
      event.kind === 'hook' &&
      event.id === latest.id &&
      ['UserPromptSubmit', 'PermissionRequest'].includes(event.name!)
    ) {
      if (processing && processing.name !== 'Stop' && event.at < processing.at) {
        return
      }
      if (
        event.name === 'UserPromptSubmit' &&
        this.facts.some(
          f => f.id === event.id && f.name === 'UserPromptSubmit' && f.epoch === event.epoch,
        ) &&
        this.facts.some(
          f => f.id === event.id && f.name === 'Stop' && f.epoch === event.epoch && f.at > event.at,
        )
      ) {
        return
      }
      fact.afterCommit = true
    }
    const duplicate = this.facts.find(
      f => f.kind === fact.kind && f.id === fact.id && f.at === fact.at && f.name === fact.name,
    )
    if (!duplicate) {
      if (event.kind === 'hook' && ['UserPromptSubmit', 'Stop'].includes(event.name!)) {
        if (this.provenance.size < 1024) {
          this.provenance.add(fact)
        } else {
          this.truncatedAt ??= this.order
          fact.firstOrder = 0
        }
      }
      this.facts.push(fact)
    } else if (event.kind === 'hook' && event.name === 'Stop') {
      duplicate.order = this.order
    }
    if (
      event.kind === 'hook' &&
      event.id === latest.id &&
      ['UserPromptSubmit', 'PermissionRequest', 'Stop'].includes(event.name!)
    ) {
      this.states.set(latest.at, { name: event.name!, at: event.at })
    }
    this.refreshPairs()
    if (this.clearSeen && this.verdict().completed) {
      this.settled.add(latest.at)
    }
    // Keep input activity attached to its capture even if a delayed earlier Start arrives.
    void current
  }
  private refreshPairs(): void {
    if (!this.clearSeen || this.truncatedAt === undefined) {
      return
    }
    const start = this.current()
    const fresh = (f: Fact) =>
      f.firstOrder > this.truncatedAt! &&
      this.epoch(f) === start &&
      (f.observedNamespace === undefined || f.observedNamespace === start.at)
    for (const stop of this.provenance) {
      if (stop.name !== 'Stop' || !fresh(stop) || this.pairings.has(stop)) {
        continue
      }
      const submit = [...this.provenance].find(
        s =>
          s.name === 'UserPromptSubmit' &&
          fresh(s) &&
          !this.pairedSubmits.has(s) &&
          s.id === stop.id &&
          s.epoch === stop.epoch &&
          s.at < stop.at,
      )
      if (submit) {
        this.pairings.set(stop, { start: start.at, submit })
        this.pairedSubmits.add(submit)
      }
    }
  }
  advance(ms: number): void {
    this.now += ms
    if (this.clearSeen && this.now - this.current().received >= 200) {
      this.settled.add(this.current().at)
    }
  }
  verdict() {
    const start = this.current()
    if (!this.clearSeen) {
      return {
        id: this.legacyActor,
        epoch: start.epoch,
        receipt: this.legacyReceipt,
        clearAllowed: false,
        completed: false,
        due: false,
        unresolved: false,
        retired: [...this.retired],
        latestAuthenticated: start.id,
        ambiguous: false,
        historyIncomplete: this.truncatedAt !== undefined,
      }
    }
    const ended = this.ended(start)
    const epoch = (f: Fact) => this.epoch(f)
    const current = (f: Fact) => epoch(f) === start
    const active = this.facts
      .filter(f => !f.capture || !this.retiredSource(f.capture))
      .filter(f => !epoch(f) || (current(f) && !ended))
      .filter(f => f.kind !== 'hook' || f.at >= start.at)
    const hooks = active.filter(f => f.kind === 'hook' && current(f)).sort((a, b) => a.at - b.at)
    const submits = hooks.filter(f => f.name === 'UserPromptSubmit'),
      lastSubmit = submits.at(-1)
    const lastSubmitCompleted =
      !!lastSubmit &&
      hooks.some(h => h.name === 'Stop' && h.epoch === lastSubmit.epoch && h.at > lastSubmit.at)
    const stops = hooks.filter(
      f =>
        f.name === 'Stop' &&
        (this.truncatedAt === undefined || this.pairings.get(f)?.start === start.at) &&
        !(
          f.observedNamespace !== undefined &&
          f.observedNamespace !== start.at &&
          this.starts.some(s => s.id !== start.id && s.at > f.observedNamespace! && s.at < start.at)
        ) &&
        (!lastSubmit || f.epoch === lastSubmit.epoch || lastSubmitCompleted),
    )
    const lastStopAt = Math.max(-Infinity, ...stops.map(s => s.at))
    const lastStopOrder = Math.max(-Infinity, ...stops.map(s => s.order))
    const stopEpochs = new Set(stops.map(s => s.epoch))
    const unresolved = active.filter(f => {
      if (f.kind === 'hook' && ['SessionStart', 'SessionEnd'].includes(f.name!)) {
        return f.name === 'SessionEnd' && !epoch(f) && f.at > start.at
      }
      return !(
        current(f) &&
        (f.kind === 'user'
          ? stopEpochs.has(f.epoch)
          : f.afterCommit && f.order > start.order
            ? lastStopOrder >= f.order
            : lastStopAt >= f.at)
      )
    })
    const completed =
      !!lastSubmit &&
      stops.some(
        s =>
          s.epoch === lastSubmit.epoch &&
          s.at > lastSubmit.at &&
          !hooks.some(e => e.name === 'SessionEnd' && e.at < s.at),
      )
    const relevant = Math.max(start.received, ...active.filter(current).map(f => f.received))
    const quiet =
      completed || stops.length > 0 || this.settled.has(start.at) || this.now - relevant >= 200
    const clear = start.epoch > 0
    const incomplete = this.truncatedAt !== undefined
    const reused = incomplete || (this.namespaces.get(start.id) ?? []).some(s => s.at < start.at)
    const afterTruncation = !incomplete || stops.some(s => this.pairings.get(s)?.start === start.at)
    const ambiguous = this.starts.filter(s => s.at === start.at).length > 1
    const receipt = this.clearSeen
      ? !ambiguous &&
        !ended &&
        afterTruncation &&
        !unresolved.length &&
        (clear || stops.length > 0) &&
        (!reused || stops.length > 0) &&
        quiet
      : this.legacyReceipt
    return {
      id: this.clearSeen ? (ambiguous ? undefined : start.id) : this.legacyActor,
      epoch: start.epoch,
      receipt,
      clearAllowed:
        !incomplete &&
        !ambiguous &&
        clear &&
        !ended &&
        !unresolved.length &&
        (!reused || stops.length > 0),
      completed,
      due: this.clearSeen && receipt && quiet,
      unresolved: unresolved.length > 0,
      retired: [...this.retired],
      latestAuthenticated: ambiguous ? undefined : start.id,
      ambiguous,
      historyIncomplete: incomplete,
    }
  }
}
