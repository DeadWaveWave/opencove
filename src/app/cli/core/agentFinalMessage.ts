import type { CommandContext } from './command'
import { CliError } from './errors'
import { readFinalMessage } from './finalMessage'
import { shellWord } from './shellWord'
import type { TurnOutcome } from '../../../shared/contracts/dto/agentRunState'
import type { GetSessionFinalMessageResult } from '../../../shared/contracts/dto/controlSurface'

export interface HookFinalMessage {
  nodeId: string | null
  sessionId: string
  turnId: string
  promptId?: string
  outcome: TurnOutcome
  message: string
  truncated: boolean
  source: 'hook'
}
type TranscriptFinalMessage = GetSessionFinalMessageResult & {
  source: 'transcript'
  truncated: false
}

/** The Worker owns turn selection; only unqualified absence permits transcript recovery. */
export async function readAgentFinalMessage(
  ctx: CommandContext,
): Promise<HookFinalMessage | TranscriptFinalMessage> {
  let result: HookFinalMessage
  try {
    result = (await ctx.invoke('agent.finalMessage', ctx.input)) as HookFinalMessage
  } catch (error) {
    const reason =
      error instanceof CliError &&
      error.details &&
      typeof error.details === 'object' &&
      'reason' in error.details
        ? error.details.reason
        : undefined
    if (
      error instanceof CliError &&
      error.code === 'agent.final_message_unavailable' &&
      ctx.options.turn === undefined &&
      (reason === 'no_ended_turn' || reason === 'provider_sent_no_message')
    ) {
      return { ...(await readFinalMessage(ctx)), source: 'transcript', truncated: false }
    }
    throw error
  }
  if (result.truncated) {
    ctx.io.stderr.write(
      `The hook message was cut (truncated). To look for the rest, read the provider transcript with "opencove session final --session ${shellWord(result.sessionId)}" or inspect the screen with "opencove agent read --node ${shellWord(String(ctx.options.node))} --screen".\n`,
    )
  }
  return result
}
