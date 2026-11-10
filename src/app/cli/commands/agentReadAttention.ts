import type { AgentRunSnapshot } from '../../../shared/contracts/dto/agentRunState'
import type { CommandContext } from '../core/command'
import { CliError } from '../core/errors'
import { shellWord } from '../core/shellWord'

/** Best-effort state must preserve cancellation and ordinary read failures. */
export async function presentReadAttention(error: CliError, ctx: CommandContext) {
  const details = error.details as Record<string, unknown> | undefined
  if (error.code !== 'agent.final_message_unavailable' || details?.reason !== 'turn_not_ended') {
    return error
  }
  let snapshot: AgentRunSnapshot | null = null
  try {
    snapshot = (await ctx.invoke(
      'agent.get',
      { nodeId: String(ctx.options.node) },
      { fresh: true },
    )) as AgentRunSnapshot | null
  } catch (lookupError) {
    if (lookupError instanceof CliError && lookupError.exitCode === 130) {
      throw lookupError
    }
    // Older Workers or a concurrently removed session may not supply state.
  }
  const current =
    snapshot &&
    snapshot.nodeId === ctx.options.node &&
    (!details.sessionId || snapshot.sessionId === details.sessionId) &&
    (ctx.options.turn === undefined || snapshot.turn?.id === ctx.options.turn)
      ? snapshot
      : null
  const state = current?.state ?? 'unknown'
  const blockedReason = state === 'waiting' ? (current?.blockedReason ?? null) : null
  const waiting = state === 'waiting'
  const label = ctx.options.turn ? `Turn ${ctx.options.turn}` : 'The selected turn'
  return new CliError(
    error.code,
    error.exitCode,
    waiting
      ? `${label} has not ended. The agent is waiting for the user${blockedReason ? ` (${blockedReason})` : ''}.`
      : error.message,
    waiting
      ? `Ask the user to resolve it in OpenCove (Desktop or this Worker's Web UI). Inspect the agent with opencove agent read --node ${shellWord(String(ctx.options.node))} --screen using the same connection options, and check the session/turn IDs match. Then run the same read again.`
      : error.hint,
    { ...details, ...(current ? { sessionId: current.sessionId } : {}), state, blockedReason },
    error.debugMessage,
  )
}
