import type {
  TerminalAgentActivitySnapshot,
  TerminalAgentShimProvider,
  TerminalSessionMetadataEvent,
} from '../../../shared/contracts/dto'

export interface TerminalAgentInvocationBaseline {
  readonly revision: number
  readonly entries: readonly TerminalSessionMetadataEvent[]
}

export interface TerminalAgentInvocationObservation {
  readonly identityAuthority: 'provider_session_start'
  readonly resumeSessionId: string
}

export interface TerminalAgentInvocation {
  readonly generation: number
  isCurrent(): boolean
  observe(observation: TerminalAgentInvocationObservation): boolean
}

export interface TerminalAgentInvocationTerminal {
  beginInvocation(input: {
    readonly invocationId: string
    readonly provider: TerminalAgentShimProvider
    readonly expectedResumeSessionId?: string | null
  }): TerminalAgentInvocation | null
  bind(sessionId: string): boolean
  complete(input: { readonly generation: number; readonly invocationId: string }): boolean
  release(): void
}

interface InvocationRecord {
  readonly generation: number
  readonly invocationId: string
  readonly provider: TerminalAgentShimProvider
  expectedResumeSessionId: string | null
  identityAuthority: 'provider_session_start' | null
  observedAtMs: number
  phase: 'active' | 'exited'
  resumeSessionId: string | null
  snapshot: TerminalAgentActivitySnapshot | null
}

interface TerminalRecord {
  readonly completedTombstones: Map<string, number>
  readonly pendingInvocations: Map<string, InvocationRecord>
  readonly sourceId: string
  current: InvocationRecord | null
  exited: boolean
  nextGeneration: number
  sessionId: string | null
}

const DEFAULT_MAX_TOMBSTONES_PER_TERMINAL = 64
const DEFAULT_MAX_PENDING_LIVE_INVOCATIONS_PER_TERMINAL = 8

export class TerminalAgentInvocationRegistry {
  private readonly listeners = new Set<(event: TerminalSessionMetadataEvent) => void>()
  private readonly sourceRevisionById = new Map<string, number>()
  private readonly terminals = new Set<TerminalRecord>()
  private readonly maxPendingLiveInvocationsPerTerminal: number
  private readonly maxTombstonesPerTerminal: number
  private revision = 0

  public constructor(
    private readonly options: {
      readonly maxPendingLiveInvocationsPerTerminal?: number
      readonly maxTombstonesPerTerminal?: number
      readonly now?: () => number
    } = {},
  ) {
    const configuredPendingLimit = options.maxPendingLiveInvocationsPerTerminal
    if (
      configuredPendingLimit !== undefined &&
      (!Number.isSafeInteger(configuredPendingLimit) || configuredPendingLimit < 0)
    ) {
      throw new Error(
        'Terminal Agent pending live invocation limit must be a non-negative integer.',
      )
    }
    const configuredLimit = options.maxTombstonesPerTerminal
    if (
      configuredLimit !== undefined &&
      (!Number.isSafeInteger(configuredLimit) || configuredLimit < 0)
    ) {
      throw new Error('Terminal Agent invocation tombstone limit must be a non-negative integer.')
    }
    this.maxPendingLiveInvocationsPerTerminal =
      configuredPendingLimit ?? DEFAULT_MAX_PENDING_LIVE_INVOCATIONS_PER_TERMINAL
    this.maxTombstonesPerTerminal = configuredLimit ?? DEFAULT_MAX_TOMBSTONES_PER_TERMINAL
  }

  public reserve(input: { readonly sourceId: string }): TerminalAgentInvocationTerminal {
    const sourceId = requireIdentifier(input.sourceId, 'sourceId')
    const terminal: TerminalRecord = {
      completedTombstones: new Map(),
      current: null,
      exited: false,
      nextGeneration: 1,
      pendingInvocations: new Map(),
      sessionId: null,
      sourceId,
    }
    this.terminals.add(terminal)

    return {
      beginInvocation: invocation => this.beginInvocation(terminal, invocation),
      bind: sessionId => this.bind(terminal, sessionId),
      complete: completion => this.complete(terminal, completion),
      release: () => this.release(terminal),
    }
  }

  public onMetadata(listener: (event: TerminalSessionMetadataEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  public list(): TerminalAgentInvocationBaseline {
    const entries = [...this.terminals]
      .map(terminal => this.baselineEntry(terminal))
      .filter((entry): entry is TerminalSessionMetadataEvent => entry !== null)
    return { revision: this.revision, entries }
  }

  private beginInvocation(
    terminal: TerminalRecord,
    input: {
      readonly invocationId: string
      readonly provider: TerminalAgentShimProvider
      readonly expectedResumeSessionId?: string | null
    },
  ): TerminalAgentInvocation | null {
    if (terminal.exited) {
      return null
    }
    const invocationId = requireIdentifier(input.invocationId, 'invocationId')
    if (
      terminal.current?.invocationId === invocationId ||
      terminal.pendingInvocations.has(invocationId) ||
      terminal.completedTombstones.has(invocationId)
    ) {
      return null
    }
    if (
      terminal.current?.phase === 'active' &&
      terminal.pendingInvocations.size >= this.maxPendingLiveInvocationsPerTerminal
    ) {
      return null
    }

    this.retireCurrent(terminal)
    const expectedResumeSessionId =
      input.expectedResumeSessionId === undefined || input.expectedResumeSessionId === null
        ? null
        : requireIdentifier(input.expectedResumeSessionId, 'expectedResumeSessionId')
    const record: InvocationRecord = {
      generation: terminal.nextGeneration++,
      expectedResumeSessionId,
      identityAuthority: null,
      invocationId,
      observedAtMs: this.now(),
      phase: 'active',
      provider: input.provider,
      resumeSessionId: null,
      snapshot: null,
    }
    terminal.current = record
    if (terminal.sessionId) {
      this.publish(terminal, record)
    }

    return {
      generation: record.generation,
      isCurrent: () => this.isCurrent(terminal, record),
      observe: observation => this.observe(terminal, record, observation),
    }
  }

  private bind(terminal: TerminalRecord, sessionIdInput: string): boolean {
    if (terminal.exited || terminal.sessionId) {
      return false
    }
    terminal.sessionId = requireIdentifier(sessionIdInput, 'sessionId')
    if (terminal.current) {
      this.publish(terminal, terminal.current)
    }
    return true
  }

  private complete(
    terminal: TerminalRecord,
    input: { readonly generation: number; readonly invocationId: string },
  ): boolean {
    if (terminal.exited || !isGeneration(input.generation)) {
      return false
    }
    const invocationId = requireIdentifier(input.invocationId, 'invocationId')
    const current = terminal.current
    if (
      current?.invocationId === invocationId &&
      current.generation === input.generation &&
      current.phase === 'active'
    ) {
      current.phase = 'exited'
      current.observedAtMs = this.now()
      if (terminal.sessionId) {
        this.publish(terminal, current)
      }
      return true
    }

    const pending = terminal.pendingInvocations.get(invocationId)
    if (!pending || pending.generation !== input.generation) {
      return false
    }
    terminal.pendingInvocations.delete(invocationId)
    this.addCompletedTombstone(terminal, pending)
    return true
  }

  private observe(
    terminal: TerminalRecord,
    record: InvocationRecord,
    observation: TerminalAgentInvocationObservation,
  ): boolean {
    if (!this.isCurrent(terminal, record) || !terminal.sessionId) {
      return false
    }
    const resumeSessionId = requireIdentifier(observation.resumeSessionId, 'resumeSessionId')
    if (
      record.expectedResumeSessionId !== null &&
      record.expectedResumeSessionId !== resumeSessionId
    ) {
      return false
    }
    if (record.resumeSessionId !== null) {
      return record.resumeSessionId === resumeSessionId
    }
    record.identityAuthority = observation.identityAuthority
    record.observedAtMs = this.now()
    record.resumeSessionId = resumeSessionId
    this.publish(terminal, record)
    return true
  }

  private release(terminal: TerminalRecord): void {
    if (terminal.exited) {
      return
    }
    const removedBaseline = this.baselineEntry(terminal) !== null
    terminal.exited = true
    this.terminals.delete(terminal)
    terminal.current = null
    terminal.pendingInvocations.clear()
    terminal.completedTombstones.clear()
    if (removedBaseline) {
      this.advanceRevision(terminal.sourceId)
    }
  }

  private retireCurrent(terminal: TerminalRecord): void {
    const current = terminal.current
    if (!current) {
      return
    }
    terminal.current = null
    if (current.phase === 'active') {
      terminal.pendingInvocations.set(current.invocationId, current)
      return
    }
    this.addCompletedTombstone(terminal, current)
  }

  private addCompletedTombstone(terminal: TerminalRecord, invocation: InvocationRecord): void {
    terminal.completedTombstones.set(invocation.invocationId, invocation.generation)
    while (terminal.completedTombstones.size > this.maxTombstonesPerTerminal) {
      const oldestInvocationId = terminal.completedTombstones.keys().next().value
      if (typeof oldestInvocationId !== 'string') {
        break
      }
      terminal.completedTombstones.delete(oldestInvocationId)
    }
  }

  private isCurrent(terminal: TerminalRecord, record: InvocationRecord): boolean {
    return !terminal.exited && terminal.current === record && record.phase === 'active'
  }

  private publish(terminal: TerminalRecord, record: InvocationRecord): void {
    const sessionId = terminal.sessionId
    if (!sessionId || terminal.exited || terminal.current !== record) {
      return
    }
    const revisions = this.advanceRevision(terminal.sourceId)
    record.snapshot = {
      generation: record.generation,
      identityAuthority: record.identityAuthority,
      invocationId: record.invocationId,
      observedAtMs: record.observedAtMs,
      phase: record.phase,
      provider: record.provider,
      revision: revisions.revision,
      sourceRevision: revisions.sourceRevision,
    }
    const event = this.createEvent(sessionId, record.resumeSessionId, record.snapshot)
    this.listeners.forEach(listener => listener(event))
  }

  private advanceRevision(sourceId: string): { revision: number; sourceRevision: number } {
    const sourceRevision = (this.sourceRevisionById.get(sourceId) ?? 0) + 1
    this.sourceRevisionById.set(sourceId, sourceRevision)
    this.revision += 1
    return { revision: this.revision, sourceRevision }
  }

  private baselineEntry(terminal: TerminalRecord): TerminalSessionMetadataEvent | null {
    const snapshot = terminal.current?.snapshot
    if (terminal.exited || !terminal.sessionId || !snapshot) {
      return null
    }
    return this.createEvent(terminal.sessionId, terminal.current?.resumeSessionId ?? null, snapshot)
  }

  private createEvent(
    sessionId: string,
    resumeSessionId: string | null,
    snapshot: TerminalAgentActivitySnapshot,
  ): TerminalSessionMetadataEvent {
    return {
      sessionId,
      resumeSessionId,
      agentProvider: snapshot.provider,
      terminalAgentActivity: { ...snapshot },
    }
  }

  private now(): number {
    return (this.options.now ?? Date.now)()
  }
}

function requireIdentifier(value: string, field: string): string {
  const normalized = value.trim()
  if (!normalized) {
    throw new Error(`Terminal Agent invocation ${field} cannot be empty.`)
  }
  return normalized
}

function isGeneration(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0
}
