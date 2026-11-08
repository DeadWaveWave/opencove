import {
  captureTurn,
  finalTurnMessage,
  type RetainedAgentTurn,
  type TurnArchiveContext,
} from './AgentTurnRecord'
import { AGENT_TURN_ARCHIVE_LIMITS } from './AgentTurnArchive'
import { createAppError } from '../../../shared/errors/appError'
import type { PromptSubmissionEvidence } from '../../../shared/runtime/agentHook/claudePromptEvidence'
import type { AgentRunModel, AgentRunObservation, AgentRunSnapshot } from '../domain/agentRunState'

type Identity = Pick<
  PromptSubmissionEvidence,
  'promptId' | 'providerSessionId' | 'providerTurnId'
> & {
  emittedAtMs?: number
  promptIds?: string[]
}
export type FinalMessageSelector = { turnId?: string; promptId?: string; nodeId?: string }

/** Private per-incarnation content owner. No references enter event or receipt rings. */
export class AgentTurnHistory {
  private revoked = false
  private active: Identity | undefined
  private readonly ended: RetainedAgentTurn[] = []
  constructor(
    private readonly archiveContext: TurnArchiveContext = {
      now: Date.now,
      nodeId: () => null,
      remote: () => false,
    },
  ) {}
  exact(turnId: string, nodeId?: string): RetainedAgentTurn | undefined {
    return this.ended.find(
      turn =>
        turn.turnId === turnId &&
        (nodeId === undefined || turn.nodeId === nodeId) &&
        turn.archivedAt >= this.archiveContext.now() - AGENT_TURN_ARCHIVE_LIMITS.ageMs,
    )
  }
  revokeNodes(ids: ReadonlySet<string>): void {
    const owner = this.archiveContext.nodeId()
    if (owner && ids.has(owner)) {
      this.revoked = true
    }
    for (let i = this.ended.length - 1; i >= 0; i--) {
      if (this.ended[i].nodeId && ids.has(this.ended[i].nodeId!)) {
        this.ended.splice(i, 1)
      }
    }
  }

  identity(): Identity & { endedTurnIds: string[] } {
    return {
      endedTurnIds: this.ended.map(turn => turn.turnId),
      ...(this.active
        ? {
            promptId: this.active.promptId,
            providerSessionId: this.active.providerSessionId,
            providerTurnId: this.active.providerTurnId,
          }
        : this.ended.at(-1)?.promptId
          ? { promptId: this.ended.at(-1)!.promptId ?? undefined }
          : {}),
    }
  }

  submissionTurnId(
    evidence: PromptSubmissionEvidence | undefined,
    currentTurnId?: string,
  ): string | undefined {
    return (
      (evidence?.promptId &&
        this.ended.find(
          turn =>
            turn.promptId === evidence.promptId || turn.promptIds?.includes(evidence.promptId!),
        )?.turnId) ||
      currentTurnId
    )
  }
  matchesSession(id: string): boolean {
    return this.active?.providerSessionId === id
  }
  hasPrompt(id?: string): boolean {
    return !!id && (this.active?.promptId === id || !!this.active?.promptIds?.includes(id))
  }
  hasEndedPrompt(id?: string): boolean {
    return !!id && this.ended.some(turn => turn.promptId === id || turn.promptIds?.includes(id))
  }
  hasCurrentPrompt(evidence?: PromptSubmissionEvidence): boolean {
    return (
      !!evidence?.promptId &&
      this.active?.promptId === evidence.promptId &&
      this.active?.providerSessionId === evidence.providerSessionId
    )
  }
  sameSubmission(observation: AgentRunObservation, evidence?: PromptSubmissionEvidence): boolean {
    return observation.hookEventName === 'UserPromptSubmit' && this.hasCurrentPrompt(evidence)
  }
  continueWith(promptId?: string): void {
    if (!this.active || !promptId) {
      return
    }
    const ids = this.active.promptIds ?? []
    if (this.active.promptId) {
      ids.push(this.active.promptId)
    }
    this.active = { ...this.active, promptId, promptIds: ids.slice(-64) }
  }

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
      !this.hasPrompt(evidence.promptId) &&
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
    if (
      this.active?.promptId !== evidence.promptId &&
      this.active?.promptIds?.includes(evidence.promptId)
    ) {
      return true
    }
    // Superseded ends are late. Replays cannot reopen or close another active turn. A repeated
    // Stop with no active turn can still refresh idle after provider continuation.
    const retained = this.ended.find(
      turn => turn.promptId === evidence.promptId || turn.promptIds?.includes(evidence.promptId!),
    )
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
        !this.hasPrompt(evidence.promptId) &&
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
    intermediate = false,
  ): void {
    if (ended && !this.revoked) {
      const correlated =
        observation?.source === 'claude_hook' &&
        observation.boundary?.kind === 'end' &&
        this.active?.promptId !== undefined &&
        this.active.promptId === evidence?.promptId &&
        this.active.providerSessionId !== undefined &&
        this.active.providerSessionId === evidence?.providerSessionId
      const content = correlated || intermediate ? evidence?.finalMessage : undefined
      this.ended.push({
        ...captureTurn(
          {
            nodeId: null,
            sessionId: next.snapshot.sessionId,
            provider: next.snapshot.provider,
            providerSessionId: this.active?.providerSessionId ?? null,
            turnId: ended.id,
            promptId: this.active?.promptId ?? null,
            outcome: next.snapshot.turnOutcome ?? 'unknown',
            endedAt: observation?.observedAt ?? next.snapshot.lastTransitionAt,
            ...(next.snapshot.turn ? { superseded: true } : {}),
            ...(intermediate ? { messageKind: 'intermediate' as const } : {}),
            message: content?.message ?? null,
            truncated: content?.truncated ?? false,
            superseded: next.snapshot.turn !== null,
          },
          this.archiveContext,
        ),
        promptIds: this.active?.promptIds,
      })
      this.active = undefined
      while (
        this.ended.length > 50 ||
        this.ended.reduce((sum, turn) => sum + Buffer.byteLength(turn.message ?? '', 'utf8'), 0) >
          512 * 1024
      ) {
        this.ended.shift()
      }
    }
    if (ended && this.revoked) {
      this.active = undefined
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
    // More exact-turn retention must not widen the existing provider-prompt selector window.
    const candidates = selector.promptId === undefined ? this.ended : this.ended.slice(-8)
    const retained = candidates.filter(record => {
      if (selector.nodeId !== undefined && record.nodeId !== selector.nodeId) {
        return false
      }
      if (
        record.nodeId &&
        this.archiveContext.membership &&
        this.archiveContext.membership(record.nodeId) !== 'member'
      ) {
        return false
      }
      if (record.archivedAt < this.archiveContext.now() - AGENT_TURN_ARCHIVE_LIMITS.ageMs) {
        return false
      }
      if (
        record.persistence.status === 'persisted' &&
        record.nodeId &&
        this.archiveContext.archive
      ) {
        try {
          return (
            this.archiveContext.archive.getExact({ nodeId: record.nodeId, turnId: record.turnId })
              .status !== 'absent'
          )
        } catch {
          return true
        }
      }
      return true
    })
    const turn = explicit
      ? retained.find(candidate =>
          selector.turnId !== undefined
            ? candidate.turnId === selector.turnId
            : candidate.promptId === selector.promptId ||
              !!candidate.promptIds?.includes(selector.promptId!),
        )
      : retained.at(-1)
    if (!turn) {
      if (
        explicit &&
        snapshot.turn &&
        (selector.turnId === snapshot.turn.id ||
          (selector.promptId !== undefined && this.hasPrompt(selector.promptId)))
      ) {
        unavailable('turn_not_ended')
      }
      return unavailable(explicit ? 'turn_not_found' : 'no_ended_turn')
    }
    return finalTurnMessage(turn)
  }
}
