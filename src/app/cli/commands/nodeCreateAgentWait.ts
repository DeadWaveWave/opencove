import type { CreateNodeResult } from '../../../shared/contracts/dto/nodeControl'
import type { CommandContext } from '../core/command'
import { CliError } from '../core/errors'
import { shellWord } from '../core/shellWord'
import { identifyInitialTurn } from '../core/agentInitialTurn'
import {
  retainTurnError,
  turnContinuation,
  turnWaitProgress,
  waitAndReadTurn,
} from '../core/agentTurnComposition'

/** Creation has already succeeded. Everything here is read-only and must retain its IDs. */
export async function waitForCreatedAgent(
  ctx: CommandContext,
  created: CreateNodeResult,
  deadline: number,
) {
  const ids = {
    nodeId: created.node.id,
    sessionId: created.node.sessionId ?? null,
    turnId: undefined as string | undefined,
  }
  const recovery = () =>
    `The agent node was created. Do not repeat node create agent. ${turnContinuation({ nodeId: ids.nodeId, turnId: ids.turnId })}`
  ctx.io.stderr.write(
    `Created agent node ${ids.nodeId} (session ${ids.sessionId ?? 'unavailable'}).\n`,
  )
  try {
    if (!ids.sessionId) {
      throw new CliError('transport.invalid_response', 1, 'The created agent has no session ID.')
    }
    const provider = created.node.data.kind === 'agent' ? created.node.data.provider : null
    if (provider && !['claude-code', 'codex'].includes(provider)) {
      throw new CliError(
        'agent.wait_unsupported',
        1,
        'Waiting for the initial prompt is supported only for Claude Code and Codex.',
        undefined,
        { reason: 'provider_unsupported', provider },
      )
    }
    ids.turnId = await identifyInitialTurn(
      ctx,
      { nodeId: ids.nodeId, sessionId: ids.sessionId },
      deadline,
    )
    ctx.io.stderr.write(turnWaitProgress({ nodeId: ids.nodeId, turnId: ids.turnId }))
    return {
      ...created,
      ...(await waitAndReadTurn(
        ctx,
        { nodeId: ids.nodeId, sessionId: ids.sessionId, turnId: ids.turnId },
        deadline,
      )),
    }
  } catch (error) {
    if (error instanceof CliError && error.code === 'agent.wait_attention' && ids.turnId) {
      throw new CliError(
        error.code,
        error.exitCode,
        'The agent needs the user’s approval or input in OpenCove.',
        `The agent node was created. Do not repeat node create agent. Resume with opencove agent wait --node ${shellWord(ids.nodeId)} --turn ${shellWord(ids.turnId)}.`,
        { ...(error.details as object), ...ids },
        error.debugMessage,
      )
    }
    throw retainTurnError(error, ids, recovery())
  }
}
