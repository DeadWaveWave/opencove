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
import { ClaudeInvocationJournal } from './ClaudeInvocationJournal'
import { ClaudeConversationTranscriptBuffer } from './ClaudeConversationTranscriptBuffer'
import { ClaudeConversationTimer } from './ClaudeConversationTimer'
import type { ClaudeConversationPorts as Ports } from './ClaudeConversationPorts'
import { boundedInsert } from '../../../shared/utils/boundedInsert'
import { CLAUDE_IDENTITY_LIMIT } from './ClaudeJournalHistory'
import * as batch from './ClaudeConversationBatch'

export const CLAUDE_CONVERSATION_WINDOW_MS = 2_000
type Request = NonNullable<ClaudeTranscriptObservation['conversation']>
/** History/observer projection only. All permission and capture decisions belong to journal. */
export class ClaudeLiveConversation {
  private lifecycle: ClaudeConversationLifecycle
  private projectedRetired = new Set<string>()
  private receipts = new Set<string>()
  private pending: Request[] = []
  private transcripts = new ClaudeConversationTranscriptBuffer()
  private timer: ClaudeConversationTimer
  private windowGeneration?: number
  private windowProvider?: string
  private openedAt?: number
  private clearPending = false
  private orphanAt?: number
  private completedBeforeClear: string | null = null
  private completedAtStart: string | null = null
  private committedAt = -Infinity
  private draining = false
  private disposed = false
  private ended = false
  private endedInClear = false
  generation = 0
  providerSessionId?: string
  constructor(
    schedule: (callback: () => void, delay: number) => () => void,
    initial?: ClaudeConversationCheckpoint,
    private now: () => number = Date.now,
    readonly journal = new ClaudeInvocationJournal(now),
  ) {
    this.timer = new ClaudeConversationTimer(schedule)
    this.lifecycle = new ClaudeConversationLifecycle(initial)
    this.providerSessionId = initial?.current ?? initial?.retired.at(-1)?.sessionId
    this.committedAt = initial?.watermark ?? -Infinity
    for (const old of initial?.retired ?? []) {
      this.retire(old.sessionId)
    }
  }
  get active(): boolean {
    return this.clearPending || this.pending.length > 0
  }
  get ready(): boolean {
    const view = this.journal.view()
    return view.ready && view.clear && !view.completed
  }
  get quarantined(): boolean {
    return this.active || this.journal.view().blocked
  }
  get clearIdentity(): string | undefined {
    const v = this.journal.view()
    return v.clear ? v.id : undefined
  }
  get checkpoint(): ClaudeConversationCheckpoint {
    return this.lifecycle.checkpoint()
  }
  get startedAt(): number | undefined {
    return this.lifecycle.checkpoint().startAt
  }
  get closedByClear(): boolean {
    return this.endedInClear
  }
  synchronize(initial?: ClaudeConversationCheckpoint): void {
    if (!initial || (initial.startAt ?? -Infinity) < (this.startedAt ?? -Infinity)) {
      return
    }
    this.lifecycle = new ClaudeConversationLifecycle(initial)
    this.providerSessionId = initial.current ?? initial.retired.at(-1)?.sessionId
    this.ended = initial.ended
    this.committedAt = Math.max(this.committedAt, initial.watermark ?? -Infinity)
    for (const old of initial.retired) {
      this.retire(old.sessionId)
    }
  }
  accept(
    record: ClaudeTranscriptObservation,
    now: number,
    ports: Ports,
    deferCommit = false,
  ): void {
    const request = record.conversation!,
      event = request.event
    const appended = this.journal.appendHook(event)
    request.decide({
      action: 'ignore',
      generation: this.generation,
      deferred: true,
      ...(this.journal.rejectsLifecycleReply(event) ? { reply: 'reject' as const } : {}),
    })
    if (this.disposed) {
      return
    }
    const key = JSON.stringify(event)
    if (this.receipts.has(key) || this.isRetiredEvent(event)) {
      request.publish(this.generation, 'ignore')
      if (appended && event.hookEventName === 'SessionEnd' && isClaudeClearEvidence(event)) {
        ports.settled()
      }
      return
    }
    if (!isClaudeConversationActivity(event) && event.hookEventName !== 'SessionStart') {
      request.publish(this.generation, 'ignore')
      return
    }
    const clear = isClaudeClearEvidence(event)
    if (clear && !Number.isFinite(event.emittedAtMs)) {
      this.reject(ports)
      request.publish(this.generation, 'ignore')
      return
    }
    const orphan =
      isClaudeConversationActivity(event) &&
      this.providerSessionId !== undefined &&
      (event.claudeSessionId !== this.providerSessionId || this.endedInClear)
    if (!clear && !this.active && !orphan) {
      this.commit(request, ports)
      return
    }
    if (!Number.isFinite(event.emittedAtMs)) {
      this.reject(ports)
      request.publish(this.generation, 'ignore')
      return
    }
    if (
      event.hookEventName === 'SessionStart' &&
      event.emittedAtMs! < (this.startedAt ?? -Infinity)
    ) {
      if (clear && !this.journal.view().clear) {
        this.reject(ports)
      }
      request.publish(this.generation, 'ignore')
      ports.settled()
      return
    }
    if (batch.predecessorConversationEnd(event, this.startedAt)) {
      request.publish(this.generation, 'ignore')
      ports.settled()
      return
    }
    const order =
      (clear &&
        event.hookEventName === 'SessionStart' &&
        event.emittedAtMs! > (this.startedAt ?? -Infinity)) ||
      this.pending.some(
        r =>
          r.event.hookEventName === 'SessionStart' &&
          r.event.claudeSessionId === event.claudeSessionId &&
          r.event.emittedAtMs! < event.emittedAtMs!,
      )
        ? 'ordered'
        : batch.conversationOrder(event, this.committedAt, this.pending.length > 0)
    if (order !== 'ordered') {
      if (order === 'untimed') {
        this.commit(request, ports)
      } else {
        if (order === 'invalid') {
          this.journal.unknown(event.claudeSessionId)
        }
        request.publish(this.generation, 'ignore')
        ports.settled()
      }
      return
    }
    boundedInsert(
      this.receipts.size,
      1024,
      () => this.receipts.add(key),
      () => this.journal.saturate(),
    )
    const opening = !this.active
    if (opening) {
      this.windowGeneration = this.generation
      this.windowProvider = this.providerSessionId
    }
    if (clear && !this.clearPending) {
      this.clearPending = true
      this.completedBeforeClear = ports.completedTurnId()
      this.openedAt = this.orphanAt ?? now
    }
    if (
      !batch.predatesPendingStart(event, this.pending) &&
      ['SessionStart', 'SessionEnd'].includes(event.hookEventName)
    ) {
      this.generation++
    }
    if (opening) {
      ports.invalidate(true)
    }
    if (this.disposed) {
      return
    }
    if (
      !boundedInsert(
        this.pending.length,
        64,
        () => this.pending.push(request),
        () => this.journal.saturate(),
      )
    ) {
      this.reject(ports)
      request.publish(this.generation, 'ignore')
      return
    }
    if (!this.clearPending) {
      this.orphanAt ??= now
      this.timer.at(this.orphanAt + CLAUDE_CONVERSATION_WINDOW_MS, now, () => this.reject(ports))
    } else {
      this.timer.at(
        Math.min(now + CLAUDE_CLEAR_QUIET_MS, this.openedAt! + CLAUDE_CLEAR_MAX_MS),
        now,
        () => this.flush(ports, true, this.now()),
      )
    }
    if (deferCommit) {
      return
    }
    if (!this.clearPending && event.hookEventName === 'SessionStart') {
      this.flush(ports, true, now)
    } else if (this.clearPending && hasCompleteClearTurn(this.pending.map(r => r.event))) {
      this.flush(ports, false, now)
    }
  }
  isRetiredEvent(event: Request['event']): boolean {
    return batch.retiredEvent(event, this.providerSessionId, this.projectedRetired, this.pending)
  }
  deferTranscript(
    record: ClaudeTranscriptObservation,
    consume: (record: ClaudeTranscriptObservation) => void,
  ): boolean {
    const result = this.transcripts.defer(
      record,
      consume,
      this.draining || this.disposed || !this.active
        ? undefined
        : { generation: this.windowGeneration, providerSessionId: this.windowProvider },
    )
    if (result === 'overflow') {
      this.journal.saturate()
    }
    return result !== 'unmatched'
  }
  private drain(): void {
    this.transcripts.drain(this.providerSessionId, this.generation, () => this.disposed)
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
      this.retire(id)
    }
    this.draining = true
    try {
      if (
        !batch.foldConversationBatch(pending, {
          retired: e => this.isRetiredEvent(e),
          commit: r => this.commit(r, ports),
          ambiguous: () => this.reject(ports),
          reject: r => r.publish(this.generation, 'ignore'),
        })
      ) {
        return
      }
      this.drain()
    } finally {
      this.draining = false
      this.windowGeneration = undefined
      this.windowProvider = undefined
    }
    if (this.disposed) {
      return
    }
    if (this.pending.length) {
      this.orphanAt ??= this.openedAt ?? now
      const deadline = Math.min(
        this.orphanAt + CLAUDE_CONVERSATION_WINDOW_MS,
        (this.openedAt ?? this.orphanAt) + CLAUDE_CLEAR_MAX_MS,
      )
      if (deadline <= now) {
        this.reject(ports)
        return
      }
      this.windowGeneration = this.generation
      this.windowProvider = this.providerSessionId
      this.timer.at(deadline, now, () => this.reject(ports))
      ports.settled()
      return
    }
    const completed = ports.completedTurnId()
    if (
      !quiet &&
      (!completed || (completed === this.completedBeforeClear && !ports.adoptedCompletion?.()))
    ) {
      ports.settled()
      return
    }
    this.closeWindow()
    this.recompute(ports, now)
  }
  private recompute(ports: Ports, now: number): void {
    const view = this.journal.view(now)
    if (this.ready && ports.canReady()) {
      ports.ready()
    } else {
      ports.settled()
    }
    if (
      !view.completed &&
      !view.unresolved &&
      !view.ended &&
      view.quietAt > now &&
      view.quietAt !== Infinity
    ) {
      this.timer.at(view.quietAt, now, () => {
        if (!this.disposed) {
          this.recompute(ports, this.now())
        }
      })
    }
  }

  commit(request: Request, ports: Ports): void {
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
      (!this.projectedRetired.has(event.claudeSessionId) ||
        event.claudeSessionId === this.providerSessionId)
    ) {
      boundedInsert(
        this.pending.length,
        64,
        () => this.pending.push(request),
        () => this.journal.saturate(),
      )
      return
    }
    // The one publication boundary: no classifier, observer or public mutation before this claim.
    if (!this.journal.claimReceipt(event, this.startedAt)) {
      request.publish(this.generation, 'ignore')
      return
    }
    if (event.hookEventName === 'SessionStart' && event.sessionStartSource === 'clear') {
      const cp = this.lifecycle.checkpoint()
      if (event.emittedAtMs! > (cp.startAt ?? -Infinity)) {
        this.lifecycle = new ClaudeConversationLifecycle({ ...cp, watermark: cp.startAt })
      }
    }
    const action = this.lifecycle.accept(event)
    if (isClaudeConversationActivity(event) || event.hookEventName === 'SessionStart') {
      this.committedAt = Math.max(this.committedAt, event.emittedAtMs ?? -Infinity)
    }
    if (action === 'ignore') {
      request.publish(
        this.generation,
        action,
        this.ended &&
          !this.endedInClear &&
          event.claudeSessionId === this.providerSessionId &&
          event.hookEventName !== 'SessionStart',
      )
      return
    }
    const completed = ports.completedTurnId()
    const legacyEnd = batch.legacyConversationEnd(
      action,
      event,
      this.clearPending,
      completed,
      this.completedAtStart,
    )
    if (action === 'start' || action === 'end') {
      this.drain()
      if (this.disposed) {
        return
      }
      if (this.providerSessionId) {
        this.retire(this.providerSessionId)
      }

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
          this.projectedRetired,
        )
        this.completedAtStart = ports.completedTurnId()
      }
      if (!legacyEnd && !ports.preserve?.(event)) {
        ports.reset()
      }
    } else {
      this.providerSessionId = event.claudeSessionId
    }
    request.publish(this.generation, action, legacyEnd, !ports.preserve?.(event))
  }
  accepts(generation: number | undefined, id: string | undefined): boolean {
    return (
      !this.disposed &&
      !(this.ended && this.endedInClear) &&
      (this.draining || !this.active) &&
      generation === this.generation &&
      id === this.providerSessionId
    )
  }
  veto(): void {
    this.journal.unknown()
  }
  private reject(ports: Ports): void {
    this.generation++
    const pending = this.closeWindow()
    ports.invalidate()
    batch.rejectConversationBatch(pending, this.generation)
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
  private retire(id: string): void {
    if (!this.projectedRetired.has(id)) {
      boundedInsert(
        this.projectedRetired.size,
        CLAUDE_IDENTITY_LIMIT,
        () => this.projectedRetired.add(id),
        () => this.journal.saturate(),
      )
    }
  }
  dispose(): void {
    this.disposed = true
    this.journal.dispose()
    this.closeWindow()
    this.receipts.clear()
    this.projectedRetired.clear()
    this.lifecycle.dispose()
  }
}
