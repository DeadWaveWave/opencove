import {
  ClaudeConversationLifecycle,
  isClaudeConversationActivity,
} from '../domain/ClaudeConversationLifecycle'
import {
  CLAUDE_CLEAR_QUIET_MS,
  CLAUDE_CLEAR_MAX_MS,
  isClaudeClearEvidence,
  hasCompleteClearTurn,
} from './ClaudeClearTransition'
import type { ClaudeTranscriptObservation } from '../../../shared/runtime/agentHook/claudeTranscript'
import type { ClaudeConversationCheckpoint } from '../../../shared/runtime/agentHook/claudeConversation'

export const CLAUDE_CONVERSATION_WINDOW_MS = 2_000
const MAX_PENDING = 64
const MAX_RECEIPTS = 256
type Request = NonNullable<ClaudeTranscriptObservation['conversation']>
type Ports = {
  reset(): void
  invalidate(pending?: boolean): void
  canReady(): boolean
  ready(): void
  settled(): void
  completedTurnId(): string | null
}
/** Invocation-local bounded event-time commit. Only the lifecycle classifier decides transitions. */
export class ClaudeLiveConversation {
  private lifecycle: ClaudeConversationLifecycle
  private readonly retired = new Set<string>()
  private readonly receipts = new Set<string>()
  private pending: Request[] = []
  private pendingTranscripts: {
    record: ClaudeTranscriptObservation
    consume(record: ClaudeTranscriptObservation): void
  }[] = []
  private windowGeneration?: number
  private windowProvider?: string
  private cancelWindow?: () => void
  private openedAt?: number
  private deadline?: number
  private clearPending = false
  private orphanAt?: number
  private completedBeforeClear: string | null = null
  private completedAtStart: string | null = null
  private committedAt = -Infinity
  private uncertain = false
  private draining = false
  private disposed = false
  private candidateReady = false
  private retentionLimited = false
  private currentClear = false
  private ended = false
  private endedInClear = false
  generation = 0
  providerSessionId?: string
  ready = false
  quarantined = false

  constructor(
    private readonly schedule: (callback: () => void, delay: number) => () => void,
    initial?: ClaudeConversationCheckpoint,
  ) {
    this.lifecycle = new ClaudeConversationLifecycle(initial)
    this.providerSessionId = initial?.current ?? initial?.retired.at(-1)?.sessionId
    for (const item of initial?.retired ?? []) {
      this.retired.add(item.sessionId)
    }
    this.retentionLimited = this.retired.size >= 64
    this.committedAt = initial?.watermark ?? -Infinity
  }
  get active(): boolean {
    return this.clearPending
  }
  synchronize(initial?: ClaudeConversationCheckpoint): void {
    if (!initial) {
      return
    }
    this.lifecycle = new ClaudeConversationLifecycle(initial)
    this.providerSessionId = initial.current ?? initial.retired.at(-1)?.sessionId
    this.committedAt = initial.watermark ?? -Infinity
    this.ended = initial.ended
    for (const item of initial.retired) {
      this.retired.add(item.sessionId)
    }
    if (this.retired.size >= 64) {
      this.retentionLimited = true
      while (this.retired.size > 64) {
        this.retired.delete(this.retired.values().next().value!)
      }
    }
  }

  accept(record: ClaudeTranscriptObservation, now: number, ports: Ports): void {
    const request = record.conversation!
    const event = request.event
    const clear = isClaudeClearEvidence(event)
    const receipt = JSON.stringify([
      event.claudeSessionId,
      event.hookEventName,
      event.emittedAtMs,
      event.sessionStartSource,
      event.sessionEndReason,
      event.promptId,
      event.state,
    ])
    request.decide({ action: 'ignore', generation: this.generation, deferred: true })
    if (this.disposed) {
      return
    }
    if (this.uncertain || this.receipts.has(receipt)) {
      request.publish(this.generation, 'ignore')
      return
    }
    const active = isClaudeConversationActivity(event) || event.hookEventName === 'SessionStart'
    // Passive notifications neither establish identity nor advance the committed watermark.
    if (!active) {
      request.publish(this.generation, 'ignore')
      return
    }
    if (clear && !Number.isFinite(event.emittedAtMs)) {
      this.failClosed(ports)
      request.publish(this.generation, 'ignore')
      return
    }
    if (this.isRetiredEvent(event)) {
      request.publish(this.generation, 'ignore')
      return
    }
    const orphan =
      isClaudeConversationActivity(event) &&
      this.providerSessionId !== undefined &&
      event.claudeSessionId !== this.providerSessionId
    if (!clear && !this.clearPending && !this.pending.length && !orphan) {
      this.remember(receipt)
      this.commit(request, ports)
      return
    }
    if (event.emittedAtMs === undefined) {
      // Keep initial legacy attachment compatibility, never use it across a timed transition.
      if (this.committedAt !== -Infinity || this.pending.length) {
        this.failClosed(ports)
        request.publish(this.generation, 'ignore')
      } else {
        this.commit(request, ports)
      }
      return
    }
    if (!Number.isFinite(event.emittedAtMs) || event.emittedAtMs <= this.committedAt) {
      if (clear || !Number.isFinite(event.emittedAtMs)) {
        this.failClosed(ports)
      }
      request.publish(this.generation, 'ignore')
      return
    }
    this.remember(receipt)
    if (!this.clearPending && !this.pending.length) {
      this.windowGeneration = this.generation
      this.windowProvider = this.providerSessionId
    }
    if (clear && !this.clearPending) {
      if (this.orphanAt !== undefined && now - this.orphanAt > CLAUDE_CONVERSATION_WINDOW_MS) {
        this.failClosed(ports)
        request.publish(this.generation, 'ignore')
        return
      }
      this.clearPending = true
      this.completedBeforeClear = ports.completedTurnId()
      this.openedAt = now
    }
    if (
      event.hookEventName === 'SessionEnd' ||
      (event.hookEventName === 'SessionStart' &&
        (clear || event.claudeSessionId !== this.providerSessionId))
    ) {
      this.generation++
    }
    this.ready = false
    if (!this.quarantined) {
      this.quarantined = true
      ports.invalidate(true)
    }
    this.enqueue(request, now, ports)
    if (!this.clearPending && event.hookEventName === 'SessionStart') {
      this.flush(ports)
    } else if (this.clearPending && hasCompleteClearTurn(this.pending.map(item => item.event))) {
      this.flush(ports, false)
    }
  }
  private isRetiredEvent(event: Request['event']): boolean {
    return (
      this.retired.has(event.claudeSessionId) &&
      event.claudeSessionId !== this.providerSessionId &&
      !(event.hookEventName === 'SessionStart' && !isClaudeClearEvidence(event))
    )
  }
  get clearIdentity(): string | undefined {
    return this.currentClear ? this.providerSessionId : undefined
  }
  get mayBeClearReady(): boolean {
    return this.ready || this.candidateReady
  }
  deferTranscript(
    record: ClaudeTranscriptObservation,
    consume: (record: ClaudeTranscriptObservation) => void,
  ): boolean {
    if (
      this.draining ||
      this.disposed ||
      this.uncertain ||
      !this.quarantined ||
      this.windowGeneration === undefined ||
      record.conversationGeneration !== this.windowGeneration ||
      record.providerSessionId !== this.windowProvider
    ) {
      return false
    }
    if (this.pendingTranscripts.length === MAX_PENDING) {
      this.pendingTranscripts = []
      this.uncertain = true
    } else {
      this.pendingTranscripts.push({ record, consume })
    }
    return true
  }
  private reconcileTranscripts(): void {
    const pending = this.pendingTranscripts
    this.pendingTranscripts = []
    for (const item of pending) {
      if (this.disposed) {
        break
      }
      if (item.record.providerSessionId === this.providerSessionId) {
        item.consume({ ...item.record, conversationGeneration: this.generation })
      }
    }
  }
  private enqueue(request: Request, now: number, ports: Ports): void {
    if (this.disposed) {
      return
    }
    if (this.pending.length === MAX_PENDING) {
      this.failClosed(ports)
      request.publish(this.generation, 'ignore')
      return
    }
    this.pending.push(request)
    if (!this.clearPending) {
      this.orphanAt ??= now
      return
    }
    const deadline = Math.min(now + CLAUDE_CLEAR_QUIET_MS, this.openedAt! + CLAUDE_CLEAR_MAX_MS)
    if (deadline !== this.deadline) {
      this.cancelWindow?.()
      this.deadline = deadline
      this.cancelWindow = this.schedule(
        () => {
          this.cancelWindow = undefined
          this.flush(ports)
        },
        Math.max(0, deadline - now),
      )
    }
  }
  private flush(ports: Ports, quiet = true): void {
    if (this.disposed) {
      return
    }
    const pending = this.pending.sort((a, b) => a.event.emittedAtMs! - b.event.emittedAtMs!)
    this.pending = []
    if (this.uncertain) {
      this.failClosed(ports)
      for (const request of pending) {
        request.publish(this.generation, 'ignore')
      }
      return
    }
    this.draining = true
    try {
      for (let i = 0; i < pending.length; ) {
        let end = i + 1
        while (
          end < pending.length &&
          pending[end].event.emittedAtMs === pending[i].event.emittedAtMs
        ) {
          end++
        }
        const group = pending.slice(i, end)
        // Predecessor callbacks have no authority even when their timestamps tie live activity.
        const live = group.filter(item => !this.isRetiredEvent(item.event))
        if (live.length > 1) {
          this.failClosed(ports)
          for (const request of pending.slice(i)) {
            request.publish(this.generation, 'ignore')
          }
          return
        }
        for (const request of group) {
          this.commit(request, ports)
        }
        i = end
      }
      this.reconcileTranscripts()
    } finally {
      this.windowGeneration = undefined
      this.windowProvider = undefined
      this.draining = false
    }
    if (this.disposed) {
      return
    }
    const completed = ports.completedTurnId()
    if (!quiet && (!completed || completed === this.completedBeforeClear)) {
      this.windowGeneration = this.generation
      this.windowProvider = this.providerSessionId
      ports.settled()
      return
    }
    this.cancelWindow?.()
    this.cancelWindow = undefined
    this.openedAt = this.deadline = this.orphanAt = undefined
    this.clearPending = false
    this.quarantined = this.uncertain
    // No temporary clear-ready projection for an intermediate conversation in this batch.
    if (this.candidateReady && !this.quarantined && ports.canReady()) {
      this.ready = true
      ports.ready()
    } else {
      this.ready = false
      ports.settled()
    }
  }
  private commit(request: Request, ports: Ports): void {
    if (this.disposed) {
      return
    }
    const event = request.event
    if (this.isRetiredEvent(event)) {
      request.publish(this.generation, 'ignore')
      return
    }
    const action = this.lifecycle.accept(event)
    if (isClaudeConversationActivity(event) || event.hookEventName === 'SessionStart') {
      this.committedAt = Math.max(this.committedAt, event.emittedAtMs ?? -Infinity)
    }
    if (action === 'ignore') {
      const legacyState =
        this.ended &&
        !this.endedInClear &&
        event.claudeSessionId === this.providerSessionId &&
        event.hookEventName !== 'SessionStart'
      request.publish(this.generation, action, legacyState)
      // Unknown successor activity without its Start can never restore the predecessor's authority.
      if (
        isClaudeConversationActivity(event) &&
        !this.retired.has(event.claudeSessionId) &&
        event.claudeSessionId !== this.providerSessionId
      ) {
        this.uncertain = true
      }
      return
    }
    const previous = this.providerSessionId
    const completed = ports.completedTurnId()
    // Once the successor completes, End has the same semantics inside and after the clear batch.
    const legacyEnd =
      action === 'end' &&
      !isClaudeClearEvidence(event) &&
      (!this.clearPending || (completed !== null && completed !== this.completedAtStart))
    if (action === 'start' || action === 'end') {
      this.ready = false
      this.reconcileTranscripts()
      if (this.disposed) {
        return
      }
      const reused = previous === event.claudeSessionId || this.retired.has(event.claudeSessionId)
      if (previous) {
        this.retired.add(previous)
      }
      if (this.retired.size > 64) {
        this.retired.delete(this.retired.values().next().value!)
        this.retentionLimited = true
      }
      this.generation++
      this.providerSessionId = event.claudeSessionId
      this.ended = action === 'end'
      this.endedInClear = this.ended && !legacyEnd
      if (action === 'start') {
        this.currentClear = event.sessionStartSource === 'clear'
        this.completedAtStart = ports.completedTurnId()
      }
      this.candidateReady =
        action === 'start' &&
        event.sessionStartSource === 'clear' &&
        !reused &&
        !this.retentionLimited
      if (!legacyEnd) {
        ports.reset()
      }
    } else {
      this.providerSessionId = event.claudeSessionId
      if (isClaudeConversationActivity(event)) {
        this.ready = false
        this.candidateReady = false
      }
    }
    request.publish(this.generation, action, legacyEnd)
  }
  accepts(generation: number | undefined, providerSessionId: string | undefined): boolean {
    if (
      this.disposed ||
      (this.ended && this.endedInClear) ||
      this.uncertain ||
      (this.quarantined && !this.draining)
    ) {
      return false
    }
    return generation === undefined
      ? this.generation === 0 &&
          (!this.providerSessionId || providerSessionId === this.providerSessionId)
      : generation === this.generation &&
          ((generation === 0 && this.providerSessionId === undefined) ||
            providerSessionId === this.providerSessionId)
  }
  private remember(receipt: string): void {
    this.receipts.add(receipt)
    if (this.receipts.size > MAX_RECEIPTS) {
      this.receipts.delete(this.receipts.values().next().value!)
    }
  }
  private failClosed(ports: Ports): void {
    this.uncertain = true
    this.quarantined = true
    this.ready = false
    this.generation++
    this.cancelWindow?.()
    this.cancelWindow = undefined
    this.openedAt = this.deadline = this.orphanAt = undefined
    this.clearPending = false
    const rejected = this.pending
    this.pending = []
    this.pendingTranscripts = []
    this.windowGeneration = undefined
    this.windowProvider = undefined
    ports.invalidate()
    for (const request of rejected) {
      request.publish(this.generation, 'ignore')
    }
  }
  veto(): void {
    this.ready = this.candidateReady = false
  }
  leave(): void {
    this.veto()
    this.currentClear = false
  }
  dispose(): void {
    this.disposed = true
    this.ready = false
    this.cancelWindow?.()
    this.cancelWindow = undefined
    this.openedAt = this.deadline = this.orphanAt = undefined
    this.clearPending = false
    this.pending = []
    this.pendingTranscripts = []
    this.windowGeneration = undefined
    this.windowProvider = undefined
  }
}
