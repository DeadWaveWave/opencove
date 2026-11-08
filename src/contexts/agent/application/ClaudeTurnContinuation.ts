import { rememberClaudeIdentity } from './ClaudeContinuationRetention'
import { ClaudeContinuationRecovery, type RecoveryPolicy } from './ClaudeContinuationRecovery'
import { debugAgentContinuation } from '../../../shared/runtime/agentHook/agentContinuationDiagnostics'
import type { PromptSubmissionEvidence } from '../../../shared/runtime/agentHook/claudePromptEvidence'
import type { ClaudeTranscriptObservation } from '../../../shared/runtime/agentHook/claudeTranscript'
import type { AgentRunObservation } from '../domain/agentRunState'
import type { AgentTurnHistory } from './AgentTurnHistory'

export const CLAUDE_CONTINUATION_WINDOW_MS = 5_000
const MAX_ITEMS = 64
export type ProviderEnd = { observation: AgentRunObservation; evidence?: PromptSubmissionEvidence }
type Item = {
  hook: boolean
  transcript: boolean
  key?: string
  state: 'queued' | 'dequeued' | 'resolved'
}

/** Registry-owned, private, per-turn reconciliation. No IO, public state or content logs. */
export class ClaudeTurnContinuation {
  readonly recovery = new ClaudeContinuationRecovery()
  private readonly baselineIds = new Set<string>()
  private origin?: ClaudeTranscriptObservation['origin']
  private blockedUntilHook = false
  private setPollingDemand?: (needed: boolean) => void
  private reconciling = false
  private generationReset = false
  private generationStartRequired = false
  private items: Item[] = []
  private cursor?: Pick<ClaudeTranscriptObservation, 'generation' | 'fileIdentity' | 'position'>
  private uncertain = false
  private stopped = false
  private latest?: ProviderEnd
  private earlyEnd?: ProviderEnd
  private earlyUser?: string
  private baselineAttached = false
  private checkpointReady = false
  private deadline?: number
  private settleAt?: number

  get nextDeadline(): number | undefined {
    return Math.min(this.deadline ?? Infinity, this.settleAt ?? Infinity) === Infinity
      ? undefined
      : Math.min(this.deadline ?? Infinity, this.settleAt ?? Infinity)
  }
  reset(): void {
    this.recovery.clear()
    this.baselineIds.clear()
    this.items = []
    this.uncertain = false
    this.stopped = false
    this.latest = undefined
    this.earlyEnd = undefined
    this.earlyUser = undefined
    this.baselineAttached = false
    this.checkpointReady = false
    this.reconciling = false
    this.deadline = undefined
    this.settleAt = undefined
  }
  private pending(): Item[] {
    return this.items.filter(item => item.state !== 'resolved')
  }
  private bound(): void {
    while (this.items.length > MAX_ITEMS) {
      const paired = this.items.findIndex(
        item => item.state === 'resolved' && item.hook && item.transcript,
      )
      const resolved =
        paired >= 0 ? paired : this.items.findIndex(item => item.state === 'resolved')
      if (resolved < 0) {
        this.items.length = MAX_ITEMS
        this.uncertain = true
        return
      }
      this.items.splice(resolved, 1)
    }
  }
  hint(): void {
    const item = this.items.find(candidate => !candidate.hook)
    if (item) {
      item.hook = true
    } else {
      this.items.push({ hook: true, transcript: false, state: 'queued' })
    }
    this.bound()
  }
  transcript(record: ClaudeTranscriptObservation, history: AgentTurnHistory, now: number): void {
    const origin = record.origin ?? 'session_file'
    if (this.origin === 'hook' && origin !== 'hook') {
      return
    }
    if (record.lifecycle === 'start') {
      if (this.cursor && record.generation <= this.cursor.generation) {
        return
      }
      if (record.setPollingDemand) {
        this.setPollingDemand = record.setPollingDemand
      }
      this.reset()
      this.acceptHook()
      this.origin = record.origin
      this.cursor = {
        generation: record.generation,
        fileIdentity: '',
        position: record.position,
      }
      this.generationReset = true
      this.generationStartRequired = true
      return
    }
    if (origin === 'hook' && this.origin !== 'hook') {
      this.cursor = undefined
    }
    this.origin = origin
    if (
      !history.matchesSession(record.providerSessionId) &&
      !this.recovery.matchesSession(record.providerSessionId)
    ) {
      return
    }
    const old = this.cursor
    if (old && record.generation < old.generation) {
      return
    }
    if (
      old &&
      record.generation === old.generation &&
      record.fileIdentity === old.fileIdentity &&
      record.position <= old.position
    ) {
      return
    }
    if (
      old &&
      old.fileIdentity !== '' &&
      (old.generation !== record.generation || old.fileIdentity !== record.fileIdentity) &&
      this.pending().length
    ) {
      this.uncertain = true
    }
    this.cursor = {
      generation: record.generation,
      fileIdentity: record.fileIdentity,
      position: record.position,
    }
    if (record.reading) {
      this.reconciling = true
    }
    if (record.record?.kind === 'checkpoint') {
      this.reconciling = false
    }
    if (record.setPollingDemand) {
      this.setPollingDemand = record.setPollingDemand
    }
    this.recovery.observe(record)
    if (record.record?.kind === 'checkpoint') {
      this.checkpointReady = !!(
        record.record.queueEmpty &&
        record.record.final &&
        history.hasCurrentPrompt({
          promptId: record.record.promptId,
          providerSessionId: record.providerSessionId,
        })
      )
    } else if (record.record) {
      this.checkpointReady = false
    }
    if (record.unavailable) {
      this.unavailable()
    }
    if (
      record.baseline &&
      record.record?.kind === 'user' &&
      record.record.promptSource === 'queued'
    ) {
      if (!history.hasEndedPrompt(record.record.promptId)) {
        rememberClaudeIdentity(this.baselineIds, record.record.promptId)
        if (this.earlyEnd?.evidence?.promptId === record.record.promptId) {
          this.confirmBaseline(record.record.promptId, history)
        }
      }
    }
    if (record.baseline || !record.record || !history.matchesSession(record.providerSessionId)) {
      return
    }
    const value = record.record
    if (value.kind === 'queue') {
      if (value.operation === 'enqueue') {
        const hint = this.items.find(item => !item.transcript)
        if (hint) {
          Object.assign(hint, { transcript: true, key: value.key })
        } else {
          this.items.push({ hook: false, transcript: true, key: value.key, state: 'queued' })
        }
        this.settleAt = undefined
      } else if (value.operation === 'unknown') {
        this.uncertain = true
      } else {
        const item = this.items.find(
          candidate =>
            (value.operation === 'remove'
              ? candidate.state !== 'resolved'
              : candidate.state === 'queued') &&
            (!value.key || candidate.key === value.key),
        )
        if (!item) {
          this.uncertain = true
        } else {
          item.state = value.operation === 'dequeue' ? 'dequeued' : 'resolved'
        }
        if (this.stopped && !this.pending().length) {
          this.settleAt = now
        }
      }
    } else if (value.kind === 'invalid_user' && this.pending().length) {
      this.uncertain = true
    } else if (
      value.kind === 'user' &&
      value.promptSource === 'queued' &&
      !history.hasPrompt(value.promptId)
    ) {
      const item = this.items.find(candidate => candidate.state === 'dequeued') ?? this.pending()[0]
      if (!item) {
        this.uncertain = true
        return
      }
      item.state = 'resolved'
      if (this.stopped) {
        this.attach(value.promptId, history)
      } else {
        this.earlyUser = value.promptId
      }
    }
    debugAgentContinuation('transcript_reconcile', {
      sessionId: record.sessionId,
      kind: value.kind,
      operation: value.kind === 'queue' ? value.operation : undefined,
      promptId: value.kind === 'user' ? value.promptId : undefined,
      pending: this.pending().length,
      baseline: record.baseline,
    })
    this.bound()
  }
  private confirmBaseline(promptId: string, history: AgentTurnHistory): void {
    const item = this.pending()[0]
    if (!this.stopped || !item) {
      return
    }
    item.state = 'resolved'
    this.baselineAttached = true
    this.attach(promptId, history)
  }
  private attach(promptId: string, history: AgentTurnHistory): void {
    history.continueWith(promptId)
    this.stopped = false
    this.settleAt = undefined
    this.deadline = undefined
  }
  /** Called only after incarnation, sequence, timestamp and authority acceptance. */
  hook(end: ProviderEnd, history: AgentTurnHistory, now: number): 'hold' | 'buffer' | 'pass' {
    debugAgentContinuation('provider_end', {
      promptId: end.evidence?.promptId,
      pending: this.pending().length,
      elapsedMs: now - end.observation.observedAt,
    })
    if (end.observation.boundary?.kind !== 'end') {
      return 'pass'
    }
    if (
      !history.hasCurrentPrompt(end.evidence) &&
      end.evidence?.promptId &&
      this.baselineIds.has(end.evidence.promptId)
    ) {
      this.confirmBaseline(end.evidence.promptId, history)
    }
    if (!history.hasCurrentPrompt(end.evidence)) {
      if (
        this.stopped &&
        this.pending().length &&
        end.evidence?.promptId &&
        history.matchesSession(end.evidence.providerSessionId ?? '') &&
        !history.hasPrompt(end.evidence.promptId)
      ) {
        if (!this.earlyEnd) {
          this.earlyEnd = end
        } else {
          this.uncertain = true
        }
        return 'buffer'
      }
      return 'pass'
    }
    if (
      !this.pending().length &&
      !this.reconciling &&
      !this.uncertain &&
      !this.earlyUser &&
      (!this.baselineAttached || this.checkpointReady)
    ) {
      return 'pass'
    }
    this.latest = end
    this.stopped = true
    this.deadline = now + CLAUDE_CONTINUATION_WINDOW_MS
    if (this.earlyUser) {
      this.attach(this.earlyUser, history)
      this.earlyUser = undefined
    }
    return 'hold'
  }
  resolve(
    history: AgentTurnHistory,
    now: number,
  ):
    | { end: ProviderEnd; unknown: boolean; ready?: boolean; recovery?: RecoveryPolicy }
    | undefined {
    if (
      this.reconciling &&
      !this.uncertain &&
      (this.deadline === undefined || now < this.deadline)
    ) {
      return undefined
    }
    if (this.earlyEnd && history.hasCurrentPrompt(this.earlyEnd.evidence)) {
      const end = this.earlyEnd
      this.earlyEnd = undefined
      if (this.hook(end, history, now) === 'pass') {
        return { end, unknown: false }
      }
    }
    if (!this.stopped || !this.latest) {
      return undefined
    }
    if (!this.pending().length && !this.uncertain && this.checkpointReady) {
      return { end: this.latest, unknown: false }
    }
    if (this.uncertain || (this.deadline !== undefined && now >= this.deadline)) {
      // A single pending follow-up plus a unique Stop is the documented identity fallback.
      if (!this.uncertain && this.earlyEnd && this.pending().length === 1) {
        const end = this.earlyEnd
        history.continueWith(end.evidence?.promptId)
        return { end, unknown: false, ready: false, recovery: this.recoveryPolicy(true) }
      }
      return { end: this.latest, unknown: true }
    }
    if (this.settleAt !== undefined && now >= this.settleAt) {
      this.settleAt = undefined
      if (this.earlyEnd) {
        return { end: this.latest, unknown: true }
      }
      if (!this.pending().some(item => item.state === 'queued')) {
        return { end: this.latest, unknown: false }
      }
    }
    return undefined
  }
  recoveryPolicy(unique = false): RecoveryPolicy {
    return {
      reason: unique
        ? 'unique_early_stop'
        : this.uncertain
          ? 'uncertain_evidence'
          : 'unresolved_queue',
      unresolved: this.pending().length,
      bufferedEnd: this.earlyEnd,
      unseenEnqueues: this.pending().filter(item => !item.transcript).length,
    }
  }
  get reading(): boolean {
    return this.reconciling
  }
  syncPollingDemand(): void {
    this.setPollingDemand?.(this.pending().length > 0 || this.stopped || this.recovery.pending)
  }
  takeGenerationReset(): boolean {
    const reset = this.generationReset
    this.generationReset = false
    return reset
  }
  get needsGenerationStart(): boolean {
    return this.generationStartRequired
  }
  acceptGenerationStart(): void {
    this.generationStartRequired = false
  }
  get degraded(): boolean {
    return this.blockedUntilHook
  }
  degradeUntilHook(): void {
    this.blockedUntilHook = true
  }
  acceptHook(): void {
    this.blockedUntilHook = false
    this.recovery.clear()
  }
  get awaiting(): boolean {
    return this.stopped
  }
  unavailable(): void {
    if (this.pending().length || this.stopped) {
      this.uncertain = true
    }
  }
}
