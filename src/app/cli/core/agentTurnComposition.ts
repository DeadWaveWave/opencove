import type { CommandContext } from './command'
import { CliError, usage } from './errors'
import { waitForAgents } from './agentWait'
import { readAgentFinalMessage } from './agentFinalMessage'
import { shellWord } from './shellWord'

export const turnReplyFields = [
  'turnId',
  'outcome',
  'endedAt',
  'reply',
  ...[
    'nodeId',
    'sessionId',
    'turnId',
    'deliveryIds',
    'promptIds',
    'promptId',
    'outcome',
    'message',
    'truncated',
    'messageKind',
    'persisted',
    'memoryOnlyReason',
    'source',
  ].map(field => `reply.${field}`),
  'replyUnavailableReason',
]
export function validateTurnWaitOptions(options: Record<string, unknown>): void {
  if (options.read && !options.wait) {
    usage('--read requires --wait.')
  }
  const timeout = Number(options.timeout ?? 20000)
  if (options.wait && (!Number.isSafeInteger(timeout) || timeout < 250 || timeout > 2147483647)) {
    usage('Wait timeout must be whole milliseconds from 250ms to 2147483647ms (about 24 days).')
  }
}
export interface TurnIdentity {
  nodeId: string
  sessionId: string
  turnId: string
}
export function turnContinuation({
  nodeId,
  turnId,
}: Pick<TurnIdentity, 'nodeId'> & Partial<TurnIdentity>): string {
  const node = shellWord(nodeId)
  return turnId
    ? `Resume with opencove agent wait --node ${node} --turn ${shellWord(turnId)}, or read with opencove agent read --node ${node} --turn ${shellWord(turnId)} -o json.`
    : `Inspect with opencove agent get --node ${node} and opencove agent read --node ${node} --screen.`
}
/** Print before a long observer so interruption leaves a concrete continuation. */
export function turnWaitProgress({
  nodeId,
  turnId,
}: Pick<TurnIdentity, 'nodeId' | 'turnId'>): string {
  return `Waiting for turn ${turnId} of node ${nodeId}. If interrupted, continue with: opencove agent wait --node ${shellWord(nodeId)} --turn ${shellWord(turnId)} (do not resend).\n`
}
/** Keep recovery evidence even for unexpected failures after a mutation. */
export function retainTurnError(error: unknown, ids: object, recovery: string): CliError {
  const e =
    error instanceof CliError
      ? error
      : new CliError('cli.failed', 1, error instanceof Error ? error.message : String(error))
  return new CliError(
    e.code,
    e.exitCode,
    e.message,
    `${e.hint ?? ''} ${recovery}`.trim(),
    {
      ...(e.details && typeof e.details === 'object' ? e.details : {}),
      ...ids,
    },
    e.debugMessage,
  )
}
/** Both initial and follow-up prompts use the same exact-turn wait/read contract. */
export async function waitAndReadTurn(ctx: CommandContext, ids: TurnIdentity, deadline: number) {
  const remaining = deadline - ctx.io.now()
  if (remaining <= 0) {
    throw new CliError('agent.wait_timeout', 124, 'Timed out waiting for the agent turn.')
  }
  const ended = await waitForAgents({
    nodeIds: [ids.nodeId],
    turnId: ids.turnId,
    any: false,
    timeoutMs: remaining,
    connection: ctx.connection!,
    fetch: ctx.io.fetch,
    signal: ctx.io.signal,
    query: (id, payload, signal) => ctx.invoke(id, payload, { fresh: true, signal }),
  })
  if (
    ended.nodeId !== ids.nodeId ||
    ended.sessionId !== ids.sessionId ||
    ended.turnId !== ids.turnId
  ) {
    throw new CliError(
      'transport.invalid_response',
      1,
      'The completed turn did not match the selected agent turn.',
    )
  }
  const result = { turnId: ids.turnId, outcome: ended.outcome, endedAt: ended.endedAt }
  if (!ctx.options.read) {
    return result
  }
  try {
    const reply = await readAgentFinalMessage({
      ...ctx,
      input: { sessionId: ids.sessionId, turnId: ids.turnId },
      options: { ...ctx.options, node: ids.nodeId, turn: ids.turnId },
    })
    if (
      !('turnId' in reply) ||
      reply.sessionId !== ids.sessionId ||
      reply.turnId !== ids.turnId ||
      (reply.nodeId !== null && reply.nodeId !== ids.nodeId)
    ) {
      throw new CliError(
        'transport.invalid_response',
        1,
        'The reply did not match the completed turn.',
      )
    }
    return { ...result, reply }
  } catch (error) {
    if (ctx.io.signal?.aborted || (error instanceof CliError && error.exitCode === 130)) {
      throw error
    }
    if (!(error instanceof CliError)) {
      throw error
    }
    const details = error.details as { reason?: string } | undefined
    return { ...result, reply: null, replyUnavailableReason: details?.reason ?? error.code }
  }
}
