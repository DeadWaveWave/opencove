import type { CommandContext } from './command'
import { CliError } from './errors'
import { shellWord } from './shellWord'
import type { AgentRunSnapshot } from '../../../shared/contracts/dto/agentRunState'
import type {
  GetSessionFinalMessageResult,
  GetSessionInput,
} from '../../../shared/contracts/dto/controlSurface'

/** Both CLI spellings validate the unprojected reply and share state-aware recovery. */
export async function readFinalMessage(ctx: CommandContext): Promise<GetSessionFinalMessageResult> {
  try {
    const result = (await ctx.invoke(
      'session.finalMessage',
      ctx.input,
    )) as GetSessionFinalMessageResult
    // Server extractors normalize whitespace-only replies to null; no distinct empty-reply marker exists.
    if (typeof result?.message !== 'string' || !result.message.trim()) {
      throw new CliError(
        'session.transcript_not_ready',
        1,
        'No readable final message is available for this session.',
      )
    }
    return result
  } catch (error) {
    if (!(error instanceof CliError) || error.code !== 'session.transcript_not_ready') {
      throw error
    }
    return unreadable(ctx, error)
  }
}

async function unreadable(ctx: CommandContext, error: CliError): Promise<never> {
  const locator = ctx.input as GetSessionInput
  let snapshot: AgentRunSnapshot | null = null
  try {
    snapshot = (await ctx.invoke('agent.get', locator, { fresh: true })) as AgentRunSnapshot | null
  } catch (inspectionError) {
    if (inspectionError instanceof CliError && inspectionError.exitCode === 130) {
      throw inspectionError
    }
  }
  const nodeId = locator.nodeId ?? snapshot?.nodeId
  const target = `--node ${shellWord(nodeId ?? '<selector>')}`
  const screen = `opencove agent read ${target} --screen`
  const message = 'No readable final message is available for this session.'
  if (
    snapshot?.state === 'idle' &&
    snapshot.turn === null &&
    snapshot.turnOutcome === 'completed'
  ) {
    throw new CliError(
      error.code,
      1,
      `${message} The provider has not written a readable transcript for this session.`,
      `Check whether provider transcript saving is disabled. Inspect the terminal with "${screen}".`,
      error.details,
    )
  }
  throw new CliError(
    error.code,
    1,
    message,
    snapshot?.state === 'working'
      ? `Use "opencove agent wait ${target} --until idle", then read again. Inspect the terminal with "${screen}".`
      : `Inspect the terminal with "${screen}" and check provider transcript saving. Use agent get to inspect the current run state.`,
    error.details,
  )
}
