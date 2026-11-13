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

import {
  conversationAttachment,
  acceptsConversationSource,
  ordinaryConversationFlags,
} from './ClaudeConversationAttachment'
import { ClaudeConversationTranscriptBuffer } from './ClaudeConversationTranscriptBuffer'
import { ClaudeConversationInput } from './ClaudeConversationInput'
import {
  ClaudeConversationReceipts,
  ClaudeConversationWatermark,
  isPossibleConversationCapture,
  ClaudeRetiredConversations,
} from './ClaudeConversationRetention'
import * as batch from './ClaudeConversationBatch'
import { ClaudeConversationTimer } from './ClaudeConversationTimer'
import type { ClaudeConversationPorts as Ports } from './ClaudeConversationPorts'

export const CLAUDE_CONVERSATION_WINDOW_MS = 2_000
const MAX_PENDING = 64
type Request = NonNullable<ClaudeTranscriptObservation['conversation']>
/** Invocation-local bounded event-time commit. Only the lifecycle classifier decides transitions. */
export class ClaudeLiveConversation {
  readonly input = new ClaudeConversationInput()
  private lifecycle!: ClaudeConversationLifecycle
  private readonly retired = new ClaudeRetiredConversations()
  private readonly receipts = new ClaudeConversationReceipts()
  private pending: Request[] = []
  private readonly transcripts = new ClaudeConversationTranscriptBuffer()
  private readonly timer: ClaudeConversationTimer
  private windowGeneration?: number
  private windowProvider?: string
  private openedAt?: number
  private clearPending = false
  private orphanAt?: number
  private completedBeforeClear: string | null = null
  private completedAtStart: string | null = null
  private committedAt = -Infinity
  private readonly watermark = new ClaudeConversationWatermark()
  private uncertain = false
  private draining = false
  private disposed = false
  private candidateReady = false
  private currentClear = false
  private ended = false
  private endedInClear = false
  generation = 0
  providerSessionId?: string
  ready = false
  quarantined = false

  constructor(
    schedule: (callback: () => void, delay: number) => () => void,
    initial?: ClaudeConversationCheckpoint,
    private readonly now: () => number = Date.now,
  ) {
    this.timer = new ClaudeConversationTimer(schedule)
    Object.assign(this, conversationAttachment(initial, this.retired))
    this.watermark.observeAt(initial?.watermark)
  }
  get active(): boolean {
    return this.clearPending || this.pending.length > 0
  }
  synchronize(initial?: ClaudeConversationCheckpoint): void {
    if (!initial) {
      return
    }
    Object.assign(this, conversationAttachment(initial, this.retired, this.committedAt))
    this.ended = initial.ended
  }

  accept(
    record: ClaudeTranscriptObservation,
    now: number,
    ports: Ports,
    deferCommit = false,
  ): void {
    const request = record.conversation!
    const event = request.event
    const clear = isClaudeClearEvidence(event)
    const receipt = ClaudeConversationReceipts.key(event)
    request.decide({ action: 'ignore', generation: this.generation, deferred: true })
    if (this.disposed) {
      return
    }
    if (batch.provenPredecessor(event, this.clearIdentity, this.startedAt)) {
      if (batch.predecessorIdentity(event.claudeSessionId, this.providerSessionId, this.pending)) {
        this.retired.add(event.claudeSessionId)
        this.input.releaseConversation(event.claudeSessionId)
        if (this.retired.limited) {
          this.veto()
        }
      }
      request.publish(this.generation, 'ignore')
      this.restoreClearReceipt(ports)
      return
    }
    if (this.isRetiredEvent(event) && (!clear || Number.isFinite(event.emittedAtMs))) {
      request.publish(this.generation, 'ignore')
      return
    }
    if (
      this.uncertain &&
      batch.canReconcile(event, this.committedAt, this.providerSessionId, this.retired) &&
      this.watermark.canRecover(event)
    ) {
      this.watermark.recoverAt(event.emittedAtMs!)
      this.uncertain = this.quarantined = false
    }
    if (
      Number.isFinite(event.emittedAtMs) &&
      (isClaudeConversationActivity(event) || event.hookEventName === 'SessionStart')
    ) {
      this.watermark.observe(event)
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
    // A timed End before the accepted Start belongs to the previous epoch, even for a reused ID.
    if (batch.predecessorConversationEnd(event, this.startedAt)) {
      request.publish(this.generation, 'ignore')
      return
    }
    const orphan =
      isClaudeConversationActivity(event) &&
      this.providerSessionId !== undefined &&
      (event.claudeSessionId !== this.providerSessionId || this.endedInClear)
    if (!clear && !this.clearPending && !this.pending.length && !orphan) {
      this.receipts.add(receipt)
      this.commit(request, ports)
      return
    }
    const order = batch.conversationOrder(event, this.committedAt, this.pending.length > 0)
    if (order !== 'ordered') {
      if (order === 'untimed') {
        this.commit(request, ports)
      } else {
        if (order === 'invalid') {
          this.failClosed(ports)
        }
        request.publish(this.generation, 'ignore')
      }
      return
    }
    this.receipts.add(receipt)
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
      this.openedAt = this.orphanAt ?? now
    }
    if (
      !batch.predatesPendingStart(event, this.pending) &&
      (event.hookEventName === 'SessionEnd' ||
        (event.hookEventName === 'SessionStart' &&
          (clear || event.claudeSessionId !== this.providerSessionId)))
    ) {
      this.generation++
    }
    this.ready = false
    if (!this.quarantined) {
      this.quarantined = true
      ports.invalidate(true)
    }
    this.enqueue(request, now, ports)
    if (deferCommit) {
      return
    }
    if (!this.clearPending && event.hookEventName === 'SessionStart') {
      this.flush(ports, true, now)
    } else if (this.clearPending && hasCompleteClearTurn(this.pending.map(item => item.event))) {
      this.flush(ports, false, now)
    }
  }
  isRetiredEvent(event: Request['event']): boolean {
    return batch.retiredEvent(event, this.providerSessionId, this.retired, this.pending)
  }
  rejectsIdentity(id: string): boolean {
    return batch.retiredConversationIdentity(id, this.providerSessionId, this.retired, this.pending)
  }
  get startedAt(): number | undefined {
    return this.lifecycle.checkpoint().startAt
  }
  acceptsSuccessorCapture(generation: number | undefined): boolean {
    const unsettled = this.active || this.quarantined || this.endedInClear
    return isPossibleConversationCapture(generation, this.generation, unsettled)
  }
  get retiredIdentities(): ReadonlySet<string> {
    return this.retired
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
    const result = this.transcripts.defer(
      record,
      consume,
      this.draining || this.disposed || this.uncertain || !this.quarantined
        ? undefined
        : { generation: this.windowGeneration, providerSessionId: this.windowProvider },
    )
    this.uncertain ||= result === 'overflow'
    return result !== 'unmatched'
  }

  private reconcileTranscripts(): void {
    this.transcripts.drain(this.providerSessionId, this.generation, () => this.disposed)
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
      this.timer.at(this.orphanAt + CLAUDE_CONVERSATION_WINDOW_MS, now, () =>
        this.failClosed(ports),
      )
      return
    }
    const deadline = Math.min(now + CLAUDE_CLEAR_QUIET_MS, this.openedAt! + CLAUDE_CLEAR_MAX_MS)
    this.timer.at(deadline, now, () => this.flush(ports, true, this.now()))
  }
  private flush(ports: Ports, quiet: boolean, now: number): void {
    if (this.disposed) {
      return
    }
    const pending = batch.orderConversationBatch(
      this.pending,
      this.providerSessionId,
      this.generation,
    )
    this.pending = []
    for (const id of batch.supersededConversationIds(pending, this.providerSessionId)) {
      this.retired.add(id)
    }
    if (this.uncertain) {
      this.failClosed(ports)
      batch.rejectConversationBatch(pending, this.generation)
      return
    }
    this.draining = true
    try {
      if (
        !batch.foldConversationBatch(pending, {
          retired: event => this.isRetiredEvent(event),
          commit: request => this.commit(request, ports),
          ambiguous: () => this.failClosed(ports),
          reject: request => request.publish(this.generation, 'ignore'),
        })
      ) {
        return
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
    if (this.pending.length) {
      this.orphanAt ??= this.openedAt!
      const deadline = Math.min(
        this.orphanAt + CLAUDE_CONVERSATION_WINDOW_MS,
        (this.openedAt ?? this.orphanAt) + CLAUDE_CLEAR_MAX_MS,
      )
      if (deadline <= now) {
        this.failClosed(ports)
        return
      }
      this.windowGeneration = this.generation
      this.windowProvider = this.providerSessionId
      this.timer.at(deadline, now, () => this.failClosed(ports))
      ports.settled()
      return
    }
    const completed = ports.completedTurnId()
    if (
      !quiet &&
      (!completed || (completed === this.completedBeforeClear && !ports.adoptedCompletion?.()))
    ) {
      this.windowGeneration = this.generation
      this.windowProvider = this.providerSessionId
      ports.settled()
      return
    }
    this.closeWindow()
    this.quarantined = this.uncertain
    this.restoreClearReceipt(ports)
  }
  private restoreClearReceipt(ports: Ports): void {
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
    if (
      event.hookEventName !== 'SessionStart' &&
      (event.claudeSessionId !== this.providerSessionId || this.endedInClear) &&
      (!this.retired.has(event.claudeSessionId) || event.claudeSessionId === this.providerSessionId)
    ) {
      this.pending.push(request)
      return
    }
    const action = this.lifecycle.accept(event)
    if (isClaudeConversationActivity(event) || event.hookEventName === 'SessionStart') {
      this.committedAt = Math.max(this.committedAt, event.emittedAtMs ?? -Infinity)
    }
    if (action === 'ignore') {
      if (this.endedInClear && (event.state === 'working' || event.state === 'waiting')) {
        this.input.block(event.emittedAtMs ?? this.now(), event.promptId)
      }
      const legacyState =
        this.ended &&
        !this.endedInClear &&
        event.claudeSessionId === this.providerSessionId &&
        event.hookEventName !== 'SessionStart'
      request.publish(this.generation, action, legacyState)
      return
    }
    const previous = this.providerSessionId
    const completed = ports.completedTurnId()
    // Once the successor completes, End has the same semantics inside and after the clear batch.
    const legacyEnd = batch.legacyConversationEnd(
      action,
      event,
      this.clearPending,
      completed,
      this.completedAtStart,
    )
    if (action === 'start' || action === 'end') {
      this.ready = false
      this.reconcileTranscripts()
      if (this.disposed) {
        return
      }
      this.input.clear()
      const reused = previous === event.claudeSessionId || this.retired.has(event.claudeSessionId)
      if (previous) {
        this.retired.add(previous)
      }
      // Queued boundaries already reserve their generation before watcher IO begins.
      if (!this.draining) {
        this.generation++
      }
      this.providerSessionId = event.claudeSessionId
      this.ended = action === 'end'
      this.endedInClear = this.ended && !legacyEnd
      if (action === 'start') {
        this.pending = batch.discardPrestartRequests(
          this.pending,
          event.claudeSessionId,
          event.emittedAtMs,
          this.generation,
          this.retired,
        )
        this.currentClear = event.sessionStartSource === 'clear'
        this.completedAtStart = ports.completedTurnId()
      }
      this.candidateReady =
        action === 'start' &&
        event.sessionStartSource === 'clear' &&
        !reused &&
        !this.retired.limited
      if (!legacyEnd && !ports.preserve?.(event)) {
        ports.reset()
      }
    } else {
      this.providerSessionId = event.claudeSessionId
      if (isClaudeConversationActivity(event)) {
        this.ready = false
        this.candidateReady = false
      }
    }
    if (action === 'start') {
      this.watermark.establishAt(event.emittedAtMs!, this.input)
    }
    request.publish(this.generation, action, legacyEnd, !ports.preserve?.(event))
    if (action === 'start') {
      ports.established?.(event.claudeSessionId)
    }
  }
  accepts(generation: number | undefined, providerSessionId: string | undefined): boolean {
    return acceptsConversationSource(
      this,
      generation,
      providerSessionId,
      this.disposed ||
        (this.ended && this.endedInClear) ||
        this.uncertain ||
        (this.quarantined && !this.draining),
    )
  }

  private failClosed(ports: Ports): void {
    this.uncertain = true
    this.quarantined = true
    this.ready = false
    this.generation++
    const rejected = this.closeWindow()
    ports.invalidate()
    batch.rejectConversationBatch(rejected, this.generation)
  }
  suspend(): void {
    this.ready = false
  }
  veto(): void {
    this.ready = this.candidateReady = false
  }
  get closedByClear(): boolean {
    return this.endedInClear
  }
  followOrdinary(
    checkpoint: ClaudeConversationCheckpoint,
    boundary: boolean,
    refresh: boolean,
  ): void {
    this.synchronize(checkpoint)
    if (boundary) {
      this.input.clear()
    }
    Object.assign(this, ordinaryConversationFlags(this.generation, boundary, refresh))
  }

  private closeWindow(): Request[] {
    this.timer.clear()
    this.openedAt = this.orphanAt = undefined
    this.clearPending = false
    const pending = this.pending
    this.pending = []
    this.transcripts.clear()
    this.windowGeneration = undefined
    this.windowProvider = undefined
    return pending
  }
  dispose(): void {
    this.disposed = true
    this.ready = false
    this.closeWindow()
  }
}
