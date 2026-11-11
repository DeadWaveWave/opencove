import type { ClaudeConversationEvent } from '../domain/ClaudeConversationLifecycle'
import type { ManagedClaudeRebindState } from './managedClaudeLaunch/ManagedClaudeRebindState'
import type {
  ClaudeQualificationIdentity,
  ClaudeResumeProof,
  ManagedClaudeBindingAdmission,
  ManagedClaudeQualificationTicket,
} from './managedClaudeLaunch/qualification'

export interface ClaudeClearEvidence {
  event: ClaudeConversationEvent
  action: 'start' | 'end' | 'event' | 'ignore'
}
type Occurrence = {
  id: string
  ordinal: number
  sessionId: string
  start: number
  prompts: Set<string>
  seen: Set<string>
}
type Pending = {
  identity: ClaudeQualificationIdentity
  path: string
  deadlineAt: number
  ticket: ManagedClaudeQualificationTicket
}
/** One authenticated invocation; orphan replay is private and never republishes turn events. */
export class ClaudeClearResumeBinding {
  private admission: ManagedClaudeBindingAdmission | null = null
  private candidate?: Occurrence
  private ordinal = 0
  private lastStart = -Infinity
  private currentId?: string
  private readonly retired = new Set<string>()
  private orphans: { event: ClaudeConversationEvent; received: number }[] = []
  private queue: Pending[] = []
  private reading = false
  private warned = false
  private closed = false
  private retry?: ReturnType<typeof setTimeout>
  constructor(
    private readonly deps: {
      owner: ManagedClaudeRebindState
      runtimeSessionId: string
      credential: object
      isCurrent(): boolean
      enabled(): boolean
      createId(): string
      now(): number
      read(
        input: ClaudeQualificationIdentity & { transcriptPath: string; deadlineAt?: number },
        signal: AbortSignal,
      ): Promise<ClaudeResumeProof | null>
      onDegraded(): void
    },
  ) {}
  observe({ event, action }: ClaudeClearEvidence): void {
    if (this.closed || !this.deps.enabled() || !this.deps.isCurrent()) {
      return
    }
    const now = this.deps.now()
    this.orphans = this.orphans.filter(item => now - item.received < 2000)
    if (event.hookEventName === 'SessionStart' && action !== 'ignore') {
      const retired = this.retired.has(event.claudeSessionId)
      if (this.currentId !== event.claudeSessionId) {
        if (this.currentId && this.retired.size < 128) {
          this.retired.add(this.currentId)
        }
        this.currentId = event.claudeSessionId
        this.candidate = undefined
      }
      if (event.sessionStartSource !== 'clear') {
        // The shared classifier distinguishes an occurrence transition from a same-ID refresh.
        if (action === 'start') {
          this.candidate = undefined
        }
        return
      }
      this.candidate = undefined
      const at = event.emittedAtMs
      if (at === undefined || at <= this.lastStart || retired || this.retired.size >= 128) {
        return
      }
      this.lastStart = at
      this.candidate = {
        id: this.deps.createId(),
        ordinal: ++this.ordinal,
        sessionId: event.claudeSessionId,
        start: at,
        prompts: new Set(),
        seen: new Set(),
      }
      const orphaned = this.orphans
      this.orphans = []
      // Only replay compatible records; receive order cannot establish provider order.
      for (const item of orphaned.sort(
        (a, b) => (a.event.emittedAtMs ?? 0) - (b.event.emittedAtMs ?? 0),
      )) {
        this.acceptTurn(item.event, item.received)
      }
      return
    }
    if (event.hookEventName === 'SessionEnd') {
      if (
        action !== 'ignore' &&
        this.candidate?.sessionId === event.claudeSessionId &&
        event.emittedAtMs !== undefined &&
        event.emittedAtMs >= this.candidate.start
      ) {
        this.candidate = undefined
      }
      return
    }
    if (!['Stop', 'UserPromptSubmit'].includes(event.hookEventName) || !event.promptId) {
      return
    }
    if (this.candidate?.sessionId === event.claudeSessionId) {
      this.acceptTurn(event)
    } else if (!this.retired.has(event.claudeSessionId) && this.orphans.length < 16) {
      this.orphans.push({ event: { ...event }, received: now })
    }
  }
  private acceptTurn(event: ClaudeConversationEvent, received = this.deps.now()): void {
    if (this.deps.now() >= received + 2000) {
      this.degrade()
      return
    }
    const candidate = this.candidate
    if (
      !candidate ||
      candidate.sessionId !== event.claudeSessionId ||
      !event.promptId ||
      event.emittedAtMs === undefined ||
      event.emittedAtMs <= candidate.start
    ) {
      return
    }
    if (event.hookEventName === 'UserPromptSubmit') {
      if (candidate.prompts.size < 64) {
        candidate.prompts.add(event.promptId)
      }
      return
    }
    if (
      event.hookEventName !== 'Stop' ||
      !candidate.prompts.has(event.promptId) ||
      candidate.seen.has(`${event.promptId}:${event.emittedAtMs}`) ||
      !event.transcriptPath
    ) {
      return
    }
    if (this.queue.length + Number(this.reading) >= 8 || candidate.seen.size >= 64) {
      this.degrade()
      return
    }
    let retryable = false
    if (!this.admission) {
      try {
        this.admission = this.deps.owner.openInvocation(
          this.deps.runtimeSessionId,
          this.deps.credential,
          this.deps.isCurrent,
        )
      } catch {
        retryable = true
        // A temporarily unavailable ledger grants no authority and must not break hook fan-out.
      }
    }
    if (!this.admission) {
      if (!retryable && this.deps.owner.admissionStatus(this.deps.runtimeSessionId) !== 'pending') {
        return
      }
      if (this.orphans.length < 16) {
        this.orphans.push({ event, received })
      }
      if (!this.retry) {
        this.retry = setTimeout(() => {
          this.retry = undefined
          if (!this.closed && this.deps.isCurrent()) {
            const records = this.orphans
              .splice(0)
              .filter(item => this.deps.now() - item.received < 2000)
            records.forEach(item => this.acceptTurn(item.event, item.received))
          }
        }, 50)
      }
      return
    }
    const identity = Object.freeze({
      occurrenceId: candidate.id,
      ordinal: candidate.ordinal,
      resumeSessionId: candidate.sessionId,
      promptId: event.promptId,
      checkpointId: `${event.promptId}:${event.emittedAtMs}`,
    })
    const ticket = this.deps.owner.beginQualification(this.admission, identity)
    if (!ticket) {
      return
    }
    candidate.seen.add(`${event.promptId}:${event.emittedAtMs}`)
    this.queue.push({
      identity,
      path: event.transcriptPath,
      ticket,
      deadlineAt: performance.now() + Math.max(0, received + 2000 - this.deps.now()),
    })
    void this.run()
  }
  private async run(): Promise<void> {
    if (this.reading) {
      return
    }
    this.reading = true
    try {
      while (this.queue.length) {
        const pending = this.queue.shift()!
        try {
          if (pending.ticket.signal.aborted) {
            continue
          }
          // oxlint-disable-next-line no-await-in-loop
          const proof = await this.deps.read(
            { ...pending.identity, transcriptPath: pending.path, deadlineAt: pending.deadlineAt },
            pending.ticket.signal,
          )
          if (pending.ticket.signal.aborted) {
            continue
          }
          // oxlint-disable-next-line no-await-in-loop
          if (proof && performance.now() < pending.deadlineAt) {
            // oxlint-disable-next-line no-await-in-loop
            await pending.ticket.submit(proof)
          } else {
            pending.ticket.discard()
            this.degrade()
          }
        } catch {
          pending.ticket.discard()
          this.degrade()
        }
      }
    } finally {
      this.reading = false
    }
  }
  private degrade(): void {
    if (!this.warned) {
      this.warned = true
      this.deps.onDegraded()
    }
  }
  close(): void {
    this.closed = true
    if (this.retry) {
      clearTimeout(this.retry)
    }
    this.orphans = []
    if (this.admission) {
      this.deps.owner.closeInvocation(this.admission)
    }
  }
}
