import { agentPromptResultSchema } from '../../../shared/contracts/dto/agentPrompt'
import { sendAgentPrompt } from '../core/agentPromptRequest'
import { waitForAgents } from '../core/agentWait'
import { readAgentFinalMessage } from '../core/agentFinalMessage'
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
  const recovery = `Never resend. Check opencove agent delivery ${shellWord(deliveryId)}; once confirmed, resume with opencove agent wait --node ${shellWord(nodeId)} --turn ${shellWord(turnId)}, or read that turn with opencove agent read.`
  ctx.io.stderr.write(`Delivery ID: ${deliveryId}; turn ID: ${turnId}. ${recovery}\n`)
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
    const remaining = deadline - ctx.io.now()
    if (remaining <= 0) {
      throw new CliError(
        'agent.wait_timeout',
        124,
        'Timed out waiting for the prompt turn. Never resend.',
      )
    }
    const ended = await waitForAgents({
      nodeIds: [nodeId],
      turnId,
      any: false,
      timeoutMs: remaining,
      connection: ctx.connection!,
      fetch: ctx.io.fetch,
      signal: ctx.io.signal,
      query: (id, payload, signal) => ctx.invoke(id, payload, { fresh: true, signal }),
    })
    if (ended.sessionId !== sessionId || ended.turnId !== turnId || ended.nodeId !== nodeId) {
      throw new CliError(
        'transport.invalid_response',
        1,
        'The completed turn did not match this prompt. Never resend.',
      )
    }
    const result = {
      ...delivery,
      nodeId,
      phase: 'submission_observed',
      outcome: ended.outcome,
      endedAt: ended.endedAt,
    }
    if (!ctx.options.read) {
      return result
    }
    try {
      const reply = await readAgentFinalMessage({
        ...ctx,
        input: { sessionId, turnId },
        options: { ...ctx.options, turn: turnId },
      })
      if (!('turnId' in reply) || reply.sessionId !== sessionId || reply.turnId !== turnId) {
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
  } catch (error) {
    if (error instanceof CliError) {
      throw new CliError(
        error.code,
        error.exitCode,
        error.message,
        `${error.hint ?? ''} ${recovery}`.trim(),
        {
          ...(error.details && typeof error.details === 'object' ? error.details : {}),
          ...ids,
          ...comparison,
        },
        error.debugMessage,
      )
    }
    throw error
  }
}
