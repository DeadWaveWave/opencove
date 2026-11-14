import { setTimeout as delay } from 'node:timers/promises'
import { agentDeliveryLookupSchema } from '../../../shared/contracts/dto/agentDelivery'
import { defineCommand, type CommandContext } from '../core/command'
import { CliError, usage } from '../core/errors'
import { declaredOutput } from './declaredOutput'

export const agentDeliveryCommand = defineCommand({
  path: ['agent', 'delivery'],
  connect: true,
  operation: 'agent.delivery.get',
  summary: 'Check retained delivery evidence; never resends input',
  description:
    'evidenceWindow (open/closed) describes collecting delivery evidence, not the agent’s work. Records live in the executing Worker. Missing, expired or restarted records are unavailable, never proof that nothing was sent. --wait polls fresh evidence. Self-wait returns immediately so the caller can release its tool call. Exit 0 submitted; 1 not_sent/ambiguous/unknown/unavailable; 124 timeout. Dispatched is still awaiting confirmation.',
  examples: [
    'opencove agent delivery delivery-123',
    'opencove agent delivery delivery-123 --wait --timeout 2m',
  ],
  positionals: [{ name: 'id', required: true }],
  options: {
    wait: { type: 'boolean', description: 'Wait for submission evidence' },
    timeout: { type: 'number', valueName: 'duration', description: 'Wait deadline (default: 20s)' },
  },
  buildInput: ({ positionals, options }) => {
    if (
      options.timeout !== undefined &&
      (!Number.isInteger(options.timeout) || Number(options.timeout) < 1)
    ) {
      usage('Timeout must be a positive whole number of milliseconds.')
    }
    return { deliveryId: positionals[0] }
  },
  render: declaredOutput(
    [
      'available',
      'deliveryId',
      'epoch',
      'incarnation',
      'sessionId',
      'nodeId',
      'mode',
      'turnId',
      'status',
      'evidenceWindow',
      'createdAt',
      'dispatchedAt',
      'evidence',
      'textComparison',
      'comparisonProfile',
      'promptId',
      'reason',
    ],
    { available: true },
  ),
  execute: waitForDelivery,
})

/** Shared confirmation observer; never sends input or retries a prompt. */
export async function waitForDelivery(ctx: CommandContext) {
  const deadline = ctx.io.now() + Number(ctx.options.timeout ?? 20000)
  const controller = new AbortController()
  let expired = false
  let lastKnown: unknown
  const timeout = setTimeout(
    () => {
      expired = true
      controller.abort()
    },
    Number(ctx.options.timeout ?? 20000),
  )
  const interrupt = () => controller.abort()
  ctx.io.signal?.addEventListener('abort', interrupt, { once: true })
  if (ctx.io.signal?.aborted) {
    interrupt()
  }
  try {
    const identity = ctx.options.wait ? await ctx.whoami() : undefined
    while (true) {
      // Sequential fresh polls observe progression; parallel reads cannot replace them.
      const wire = await ctx.invoke('agent.delivery.get', ctx.input, {
        fresh: true,
        signal: controller.signal,
      })
      const parsed = agentDeliveryLookupSchema.safeParse(wire)
      if (!parsed.success) {
        throw new CliError('transport.invalid_response', 1, 'Invalid delivery status response')
      }
      const result = parsed.data
      lastKnown = result
      const self =
        result.available && !!identity?.sessionId && identity.sessionId === result.sessionId
      if (
        !ctx.options.wait ||
        self ||
        !result.available ||
        ['submitted', 'not_sent', 'ambiguous', 'unknown'].includes(result.status)
      ) {
        // run() renders the DTO before applying this command's evidence exit code.
        return result
      }
      if (ctx.io.now() >= deadline) {
        throw new CliError(
          'cli.timeout',
          124,
          'Delivery evidence wait deadline expired. Never resend.',
          undefined,
          { lastKnown: result },
        )
      }
      await delay(Math.min(250, Math.max(1, deadline - ctx.io.now())), undefined, {
        signal: controller.signal,
      })
    }
  } catch (error) {
    if (expired) {
      throw new CliError(
        'cli.timeout',
        124,
        'Delivery evidence wait deadline expired. Never resend.',
        undefined,
        { lastKnown },
      )
    }
    if (ctx.io.signal?.aborted) {
      throw new CliError('cli.interrupted', 130, 'Interrupted. Never resend.')
    }
    throw error
  } finally {
    clearTimeout(timeout)
    ctx.io.signal?.removeEventListener('abort', interrupt)
  }
}
