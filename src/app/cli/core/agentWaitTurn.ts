import * as z from 'zod'
import type { AgentRunEvent, AgentRunSnapshot } from '../../../shared/contracts/dto/agentRunState'
import { CliError } from './errors'
import { presentAgentTurnError, type AgentTurnErrorContext } from './agentTurnError'

const historySchema = z.object({
  deliveryIds: z.array(z.string()).optional(),
  promptIds: z.array(z.string()).optional(),
  sessionId: z.string(),
  turnId: z.string(),
  outcome: z.enum(['completed', 'failed', 'aborted', 'unknown']),
  nodeId: z.string().nullable().optional(),
  persisted: z.boolean().default(false),
  memoryOnlyReason: z.string().optional(),
  endedAt: z.number().finite().optional(),
})
const noMessageSchema = historySchema
  .pick({ outcome: true, endedAt: true, deliveryIds: true, promptIds: true })
  .extend({
    // Older Workers did not include the outcome of a message-free end.
    outcome: historySchema.shape.outcome.default('unknown'),
  })
export interface TurnWaitResult {
  nodeId: string
  sessionId: string
  turnId: string
  outcome: NonNullable<AgentRunSnapshot['turnOutcome']>
  deliveryIds?: string[]
  promptIds?: string[]
  endedAt?: number
  persisted: boolean
  memoryOnlyReason?: string
  state: AgentRunSnapshot['state']
}
export function turnUnavailable(
  turnId: string,
  remote = false,
  context: AgentTurnErrorContext = {},
  reason = remote ? 'remote_history_unavailable' : 'turn_not_found',
): CliError {
  return presentAgentTurnError(
    new CliError(
      'agent.wait_turn_unavailable',
      1,
      `No retained end evidence for turn ${turnId}.`,
      undefined,
      { reason },
    ),
    { ...context, turnId },
  )
}

// @compat cli-legacy-input-handling
/** A retained identity or a legacy event can certify an end without any history IO. */
export function selectedTurnEnd(
  snapshot: AgentRunSnapshot,
  turnId: string,
  event?: AgentRunEvent,
): TurnWaitResult | null {
  if (snapshot.turn?.id === turnId) {
    return null
  }
  const result = (outcome: TurnWaitResult['outcome'], endedAt?: number): TurnWaitResult => ({
    nodeId: snapshot.nodeId!,
    sessionId: snapshot.sessionId,
    turnId,
    outcome,
    persisted: false,
    memoryOnlyReason: 'unavailable',
    ...(endedAt !== undefined ? { endedAt } : {}),
    state: snapshot.state,
  })
  if (snapshot.lastEndedTurn?.id === turnId) {
    return result(snapshot.lastEndedTurn.outcome, snapshot.lastEndedTurn.endedAt)
  }
  if (
    event?.type === 'agent.turn_completed' &&
    event.endedTurn?.id === turnId &&
    !snapshot.lastEndedTurn
  ) {
    return result(event.snapshot.turnOutcome ?? 'unknown')
  }
  return null
}

/** Select only identity-specific end evidence; history content never enters the wait result. */
export async function endedSelectedTurn(
  snapshot: AgentRunSnapshot,
  turnId: string,
  query: (payload: { sessionId: string; turnId: string }) => Promise<unknown>,
  event?: AgentRunEvent,
): Promise<TurnWaitResult | null> {
  const retained = selectedTurnEnd(snapshot, turnId, event)
  if (retained || snapshot.turn?.id === turnId) {
    return retained
  }
  const result = (outcome: TurnWaitResult['outcome'], endedAt?: number): TurnWaitResult => ({
    nodeId: snapshot.nodeId!,
    sessionId: snapshot.sessionId,
    turnId,
    outcome,
    persisted: false,
    memoryOnlyReason: 'unavailable',
    ...(endedAt !== undefined ? { endedAt } : {}),
    state: snapshot.state,
  })
  try {
    // Bind history to this snapshot's session, not a potentially replaced node binding.
    const history = historySchema.parse(await query({ sessionId: snapshot.sessionId, turnId }))
    if (history.sessionId !== snapshot.sessionId || history.turnId !== turnId) {
      throw turnUnavailable(turnId, false, {
        nodeId: snapshot.nodeId ?? undefined,
        sessionId: snapshot.sessionId,
      })
    }
    return { ...result(history.outcome, history.endedAt), ...turnIdentifiers(history) }
  } catch (error) {
    if (error instanceof CliError && error.code === 'agent.final_message_unavailable') {
      const details = error.details as { reason?: string } | undefined
      if (details?.reason === 'provider_sent_no_message') {
        const end = noMessageSchema.parse(details)
        return { ...result(end.outcome, end.endedAt), ...turnIdentifiers(end) }
      }
      if (details?.reason === 'turn_not_ended') {
        return null
      }
      if (details?.reason === 'remote_history_unavailable') {
        throw turnUnavailable(turnId, true, {
          nodeId: snapshot.nodeId ?? undefined,
          sessionId: snapshot.sessionId,
        })
      }
      if (details?.reason === 'turn_not_found' || details?.reason === 'no_ended_turn') {
        throw turnUnavailable(
          turnId,
          false,
          { nodeId: snapshot.nodeId ?? undefined, sessionId: snapshot.sessionId },
          details.reason,
        )
      }
    }
    throw error
  }
}

/** Historical lookup is independent of the current PTY/incarnation, and can prove metadata-only ends. */
export async function archivedSelectedTurn(
  nodeId: string,
  turnId: string,
  query: (payload: { nodeId: string; turnId: string }) => Promise<unknown>,
): Promise<TurnWaitResult | null> {
  const result = (value: z.infer<typeof historySchema>): TurnWaitResult => {
    if (value.nodeId !== nodeId || value.turnId !== turnId) {
      throw turnUnavailable(turnId, false, { nodeId })
    }
    return {
      ...turnIdentifiers(value),
      nodeId,
      sessionId: value.sessionId,
      turnId,
      outcome: value.outcome,
      persisted: value.persisted,
      ...(value.memoryOnlyReason ? { memoryOnlyReason: value.memoryOnlyReason } : {}),
      ...(value.endedAt !== undefined ? { endedAt: value.endedAt } : {}),
      state: 'unknown',
    }
  }
  try {
    const value = historySchema.parse(await query({ nodeId, turnId }))
    return result(value)
  } catch (error) {
    if (error instanceof CliError && error.code === 'agent.final_message_unavailable') {
      const details = error.details as Record<string, unknown> | undefined
      if (details?.reason === 'turn_not_ended') {
        return null
      }
      if (details?.reason === 'provider_sent_no_message') {
        return result(historySchema.parse(details))
      }
      throw turnUnavailable(
        turnId,
        false,
        { nodeId },
        typeof details?.reason === 'string' ? details.reason : 'archive_unavailable',
      )
    }
    throw error
  }
}

function turnIdentifiers(value: { deliveryIds?: string[]; promptIds?: string[] }) {
  return {
    ...(value.deliveryIds ? { deliveryIds: value.deliveryIds } : {}),
    ...(value.promptIds ? { promptIds: value.promptIds } : {}),
  }
}
