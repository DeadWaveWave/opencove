import { agentPromptResultSchema } from '../../../shared/contracts/dto/agentPrompt'
import { sendAgentPrompt } from '../core/agentPromptRequest'
import {
  retainTurnError,
  turnContinuation,
  turnWaitProgress,
  waitAndReadTurn,
} from '../core/agentTurnComposition'
import type { CommandContext } from '../core/command'
import { CliError } from '../core/errors'
import { promptComparisonNotice } from '../core/promptTransport'
import { shellWord } from '../core/shellWord'
import { waitForDelivery } from './agentDelivery'

/** Compose authoritative evidence, never infer consumption from turn completion. */
export async function promptAndWait(ctx: CommandContext): Promise<unknown> {
  // Identity is a preflight: its cached query cannot outlive the confirmation deadline.
  const identity = ctx.options.wait ? await ctx.whoami() : undefined
  const sent = await sendAgentPrompt(ctx)
  const comparisonNotice = promptComparisonNotice(sent)
  if (comparisonNotice) {
    ctx.io.stderr.write(comparisonNotice + '\n')
  }
  if (!ctx.options.wait) {
    return sent
  }
  const parsed = agentPromptResultSchema.safeParse(sent)
  if (!parsed.success) {
    throw new CliError(
      'transport.invalid_response',
      1,
      'The prompt response could not be read. Never resend.',
      'Inspect the delivery ID printed before sending and the agent screen.',
    )
  }
  const delivery = parsed.data
  const nodeId = delivery.nodeId ?? String(ctx.options.node)
  const { deliveryId, sessionId, turnId } = delivery
  const ids = { deliveryId, nodeId, sessionId, turnId }
  const comparison = {
    textComparison: delivery.textComparison,
    ...(delivery.comparisonProfile ? { comparisonProfile: delivery.comparisonProfile } : {}),
    ...(delivery.promptId ? { promptId: delivery.promptId } : {}),
  }
  const recovery = `Never resend. Check opencove agent delivery ${shellWord(deliveryId)}; once confirmed, ${turnContinuation({ nodeId, turnId })}`
  ctx.io.stderr.write(turnWaitProgress({ nodeId, turnId }))
  // The send operation has its own short budget; this deadline is shared by both observers.
  const deadline = ctx.io.now() + Number(ctx.options.timeout ?? 20000)
  try {
    const confirmed = await waitForDelivery({
      ...ctx,
      input: { deliveryId },
      whoami: async () => identity!,
      options: { wait: true, timeout: Math.max(1, deadline - ctx.io.now()) },
    })
    if (!confirmed.available || confirmed.status !== 'submitted') {
      throw new CliError(
        'agent.prompt_stalled',
        1,
        'Prompt submission is unconfirmed. Never resend.',
        `Check opencove agent delivery ${shellWord(deliveryId)} or inspect the agent screen.`,
        { lastKnown: confirmed },
      )
    }
    if (
      confirmed.deliveryId !== deliveryId ||
      confirmed.sessionId !== sessionId ||
      confirmed.turnId !== turnId ||
      (confirmed.nodeId !== null && confirmed.nodeId !== nodeId)
    ) {
      throw new CliError(
        'transport.invalid_response',
        1,
        'Delivery confirmation did not match this prompt. Never resend.',
      )
    }
    return {
      ...delivery,
      nodeId,
      phase: 'submission_observed',
      ...(await waitAndReadTurn(ctx, { nodeId, sessionId, turnId }, deadline)),
    }
  } catch (error) {
    throw retainTurnError(error, { ...ids, ...comparison }, recovery)
  }
}
