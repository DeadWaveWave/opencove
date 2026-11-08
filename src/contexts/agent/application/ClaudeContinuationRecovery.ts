import { CLAUDE_CORRELATION_LIMIT, rememberClaudeIdentity } from './ClaudeContinuationRetention'
import { debugAgentContinuation } from '../../../shared/runtime/agentHook/agentContinuationDiagnostics'
import type { ClaudeTranscriptObservation } from '../../../shared/runtime/agentHook/claudeTranscript'
import type { PromptSubmissionEvidence } from '../../../shared/runtime/agentHook/claudePromptEvidence'
import type { AgentRunObservation, AgentRunSnapshot } from '../domain/agentRunState'
import type { ProviderEnd } from './ClaudeTurnContinuation'

export type RecoveryPolicy = {
  reason: 'unique_early_stop' | 'uncertain_evidence' | 'unresolved_queue'
  unresolved: number
  unseenEnqueues?: number
  bufferedEnd?: ProviderEnd
}
type Ticket = {
  turnId: string
  end: ProviderEnd
  latestRelayAt?: number
  confirmed: boolean
  policy: RecoveryPolicy
  users: Set<string>
  candidateId?: string
  stops: Map<string, { end: ProviderEnd; correlated: boolean }>
}

/** Bounded content-free chain; recovery changes readiness, never the recorded turn outcome. */
export class ClaudeContinuationRecovery {
  private ticket?: Ticket
  remember(turnId: string, end: ProviderEnd, policy: RecoveryPolicy): void {
    this.ticket = {
      turnId,
      confirmed: false,
      latestRelayAt: end.observation.emittedAtMs,
      policy: {
        reason: policy.reason,
        unresolved: policy.unresolved,
        unseenEnqueues: policy.unseenEnqueues,
      },
      users: new Set(),
      stops: new Map(),
      end: this.privateEnd(end),
    }
    if (policy.bufferedEnd) {
      this.captureEnd(policy.bufferedEnd)
    }
  }
  private privateEnd(end: ProviderEnd): ProviderEnd {
    return {
      observation: end.observation,
      evidence: {
        promptId: end.evidence?.promptId,
        providerSessionId: end.evidence?.providerSessionId,
      },
    }
  }
  get pending(): boolean {
    return !!this.ticket
  }
  clear(): void {
    this.ticket = undefined
  }
  matchesSession(id: string): boolean {
    return this.ticket?.end.evidence?.providerSessionId === id
  }
  /** A late Stop may precede its queued user record. It cannot publish readiness itself. */
  captureEnd(end: ProviderEnd, reading = false): boolean {
    const ticket = this.ticket,
      id = end.evidence?.promptId
    if (
      !ticket ||
      !id ||
      (!reading && id === ticket.end.evidence?.promptId) ||
      !this.matchesSession(end.evidence?.providerSessionId ?? '') ||
      ticket.latestRelayAt === undefined ||
      end.observation.emittedAtMs === undefined ||
      end.observation.emittedAtMs <= ticket.latestRelayAt
    ) {
      return false
    }
    const prior = ticket.stops.get(id)
    if (!prior || end.observation.emittedAtMs > (prior.end.observation.emittedAtMs ?? Infinity)) {
      this.retainStop(ticket, id, this.privateEnd(end))
    }
    if (ticket.users.has(id) || prior?.correlated) {
      ticket.latestRelayAt = Math.max(ticket.latestRelayAt, end.observation.emittedAtMs)
    }
    if (
      (ticket.candidateId === id && ticket.users.has(id)) ||
      id === ticket.end.evidence?.promptId
    ) {
      this.correlate(ticket, this.privateEnd(end))
    }
    ticket.confirmed = false
    return true
  }
  private retainStop(ticket: Ticket, id: string, end: ProviderEnd): void {
    const prior = ticket.stops.get(id)
    if (!prior && ticket.stops.size >= CLAUDE_CORRELATION_LIMIT) {
      // Eviction must not turn an already matched Stop into an unresolved one merely
      // because its older user ID rolled out of the separate history window.
      const victim = [...ticket.stops].find(
        ([key, value]) => value.correlated && key !== ticket.candidateId,
      )
      if (!victim) {
        // Preserve awaiting Stops and the candidate, also retained in ticket.end.
        return
      }
      ticket.stops.delete(victim[0])
    }
    ticket.stops.delete(id)
    ticket.stops.set(id, { end, correlated: prior?.correlated === true || ticket.users.has(id) })
  }
  observe(record: ClaudeTranscriptObservation): void {
    const ticket = this.ticket,
      value = record.record
    if (!ticket || !this.matchesSession(record.providerSessionId)) {
      return
    }
    // Correlation is incremental; the only commit evidence is the final checkpoint of a read.
    ticket.confirmed = false
    if (record.unavailable || !value) {
      return
    }
    if (value.kind === 'user') {
      ticket.candidateId = value.promptId
    } else if (value.kind === 'invalid_user') {
      ticket.candidateId = undefined
    }
    if (value.kind === 'queue' && !record.baseline) {
      if (value.operation === 'enqueue') {
        if (ticket.policy.unseenEnqueues) {
          ticket.policy.unseenEnqueues--
        } else {
          ticket.policy.unresolved = Math.min(64, ticket.policy.unresolved + 1)
        }
      } else if (value.operation === 'remove') {
        ticket.policy.unresolved = Math.max(0, ticket.policy.unresolved - 1)
      }
    }
    if (value.kind === 'user' && value.promptSource === 'queued') {
      if (rememberClaudeIdentity(ticket.users, value.promptId)) {
        ticket.policy.unresolved = Math.max(0, ticket.policy.unresolved - 1)
        ticket.policy.unseenEnqueues = Math.min(
          ticket.policy.unseenEnqueues ?? 0,
          ticket.policy.unresolved,
        )
      }
      const end = ticket.stops.get(value.promptId)
      if (end) {
        end.correlated = true
        this.correlate(ticket, end.end)
      }
    }
    if (value.kind !== 'checkpoint' || !value.queueEmpty || !value.final || !value.promptId) {
      return
    }
    const end =
      value.promptId === ticket.end.evidence?.promptId
        ? ticket.end
        : ticket.users.has(value.promptId)
          ? ticket.stops.get(value.promptId)?.end
          : undefined
    if (!end) {
      return
    }
    this.correlate(ticket, end)
    ticket.confirmed = true
    debugAgentContinuation('recovery_evidence', {
      sessionId: record.sessionId,
      promptId: value.promptId,
      kind: value.kind,
      baseline: record.baseline,
    })
  }
  private correlate(ticket: Ticket, end: ProviderEnd): void {
    ticket.end = end
    if (end.observation.emittedAtMs !== undefined) {
      ticket.latestRelayAt = Math.max(
        ticket.latestRelayAt ?? -Infinity,
        end.observation.emittedAtMs,
      )
    }
  }
  newerLifecycle(
    observation: AgentRunObservation,
    evidence?: PromptSubmissionEvidence,
    activeCorrelated = false,
  ): boolean {
    const end = this.ticket?.end,
      retainedAt = this.ticket?.latestRelayAt
    return !!(
      end &&
      observation.source === 'claude_hook' &&
      !observation.degraded &&
      (observation.boundary?.kind === 'start' || observation.boundary?.kind === 'end') &&
      evidence?.promptId &&
      evidence.providerSessionId === end.evidence?.providerSessionId &&
      (observation.boundary.kind === 'start' ||
        evidence.promptId === end.evidence?.promptId ||
        activeCorrelated) &&
      retainedAt !== undefined &&
      observation.emittedAtMs !== undefined &&
      observation.emittedAtMs > retainedAt
    )
  }
  take(snapshot: AgentRunSnapshot): ProviderEnd | undefined {
    const ticket = this.ticket
    if (
      !ticket?.confirmed ||
      snapshot.turn ||
      snapshot.state === 'exited' ||
      snapshot.lastEndedTurn?.id !== ticket.turnId
    ) {
      return undefined
    }
    this.clear()
    return ticket.end
  }
}
