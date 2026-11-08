import { createAppError } from '../../../shared/errors/appError'
import type { PromptSubmissionEvidence } from '../../../shared/runtime/agentHook/claudePromptEvidence'
import type {
  AgentRunModel,
  AgentRunObservation,
  AgentRunSnapshot,
  TurnOutcome,
} from '../domain/agentRunState'

type Identity = Pick<
  PromptSubmissionEvidence,
  'promptId' | 'providerSessionId' | 'providerTurnId'
> & {
  emittedAtMs?: number
}
type EndedTurn = {
  turnId: string
  promptId?: string
  outcome: TurnOutcome
  endedAt: number
  message?: string
  truncated?: boolean
  superseded?: boolean
}
export type FinalMessageSelector = { turnId?: string; promptId?: string }

/** Private per-incarnation content owner. No references enter event or receipt rings. */
export class AgentTurnHistory {
  private active: Identity | undefined
  private readonly ended: EndedTurn[] = []

  /** Relay-time ordering survives message eviction; reducer authority checks still apply. */
  supersedes(
    observation: AgentRunObservation | null,
    evidence?: PromptSubmissionEvidence,
  ): boolean {
    return !!(
      observation?.source === 'claude_hook' &&
      observation.hookEventName === 'UserPromptSubmit' &&
      observation.boundary?.kind === 'start' &&
      observation.boundary.evidence === 'prompt_submit' &&
      this.active?.promptId &&
      evidence?.promptId &&
      this.active.promptId !== evidence.promptId &&
      this.active.emittedAtMs !== undefined &&
      observation.emittedAtMs !== undefined &&
      observation.emittedAtMs > this.active.emittedAtMs &&
      this.active.providerSessionId &&
      this.active.providerSessionId === evidence.providerSessionId
    )
  }

  rejects(observation: AgentRunObservation, evidence?: PromptSubmissionEvidence): boolean {
    if (observation.source === 'codex_hook' && observation.hookEventName === 'notify') {
      // Reject before arbitration: refusing only completion would still project false idle.
      return !!(
        (this.active?.providerTurnId &&
          evidence?.providerTurnId &&
          this.active.providerTurnId !== evidence.providerTurnId) ||
        (this.active?.providerSessionId &&
          evidence?.providerSessionId &&
          this.active.providerSessionId !== evidence.providerSessionId)
      )
    }
    if (observation.source !== 'claude_hook' || !evidence?.promptId) {
      return false
    }
    if (observation.boundary?.kind !== 'start' && observation.boundary?.kind !== 'end') {
      return false
    }
    // Superseded ends are late. Replays cannot reopen or close another active turn. A repeated
    // Stop with no active turn can still refresh idle after provider continuation.
    const retained = this.ended.find(turn => turn.promptId === evidence.promptId)
    if (retained) {
      return (
        retained.superseded === true ||
        observation.boundary.kind === 'start' ||
        this.active !== undefined
      )
    }
    if (!this.active) {
      return false
    }
    return !!(
      (this.active.promptId &&
        this.active.promptId !== evidence.promptId &&
        !this.supersedes(observation, evidence)) ||
      (this.active.providerSessionId &&
        evidence.providerSessionId &&
        this.active.providerSessionId !== evidence.providerSessionId)
    )
  }

  accept(
    previous: AgentRunModel,
    next: AgentRunModel,
    ended: AgentRunSnapshot['turn'],
    observation: AgentRunObservation | null,
    evidence?: PromptSubmissionEvidence,
  ): void {
    if (ended) {
      const correlated =
        observation?.source === 'claude_hook' &&
        observation.boundary?.kind === 'end' &&
        this.active?.promptId !== undefined &&
        this.active.promptId === evidence?.promptId &&
        this.active.providerSessionId !== undefined &&
        this.active.providerSessionId === evidence?.providerSessionId
      const content = correlated ? evidence?.finalMessage : undefined
      this.ended.push({
        turnId: ended.id,
        promptId: this.active?.promptId,
        outcome: next.snapshot.turnOutcome ?? 'unknown',
        endedAt: observation?.observedAt ?? next.snapshot.lastTransitionAt,
        ...(next.snapshot.turn ? { superseded: true } : {}),
        ...(content ? { message: content.message, truncated: content.truncated } : {}),
      })
      this.active = undefined
      while (
        this.ended.length > 8 ||
        this.ended.reduce((sum, turn) => sum + Buffer.byteLength(turn.message ?? '', 'utf8'), 0) >
          512 * 1024
      ) {
        this.ended.shift()
      }
    }
    if (next.snapshot.turn && previous.snapshot.turn?.id !== next.snapshot.turn.id) {
      this.active =
        observation?.source === 'claude_hook'
          ? {
              promptId: evidence?.promptId,
              providerSessionId: evidence?.providerSessionId,
              emittedAtMs:
                observation.hookEventName === 'UserPromptSubmit'
                  ? observation.emittedAtMs
                  : undefined,
            }
          : observation?.source === 'codex_hook'
            ? {
                providerTurnId: evidence?.providerTurnId,
                providerSessionId: evidence?.providerSessionId,
              }
            : {}
    }
  }

  read(snapshot: AgentRunSnapshot, selector: FinalMessageSelector) {
    const unavailable = (reason: string, details: object = {}): never => {
      throw createAppError('agent.final_message_unavailable', { details: { reason, ...details } })
    }
    const explicit = selector.turnId !== undefined || selector.promptId !== undefined
    const turn = explicit
      ? this.ended.find(candidate =>
          selector.turnId !== undefined
            ? candidate.turnId === selector.turnId
            : candidate.promptId === selector.promptId,
        )
      : this.ended.at(-1)
    if (!turn) {
      if (
        explicit &&
        snapshot.turn &&
        (selector.turnId === snapshot.turn.id ||
          (selector.promptId !== undefined && selector.promptId === this.active?.promptId))
      ) {
        unavailable('turn_not_ended')
      }
      return unavailable(explicit ? 'turn_not_found' : 'no_ended_turn')
    }
    if (turn.message === undefined) {
      return unavailable('provider_sent_no_message', {
        outcome: turn.outcome,
        endedAt: turn.endedAt,
      })
    }
    return {
      nodeId: snapshot.nodeId,
      sessionId: snapshot.sessionId,
      turnId: turn.turnId,
      ...(turn.promptId !== undefined ? { promptId: turn.promptId } : {}),
      outcome: turn.outcome,
      message: turn.message,
      truncated: turn.truncated ?? false,
      source: 'hook' as const,
    }
  }
}
