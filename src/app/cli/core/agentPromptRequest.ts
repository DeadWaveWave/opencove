import { randomUUID } from 'node:crypto'
import type { CommandContext } from './command'
import { CliError } from './errors'

/** The describe query is cached by the connection's per-command query cache. No write retry. */
export async function sendAgentPrompt(ctx: CommandContext): Promise<unknown> {
  let properties: Record<string, unknown> | undefined
  try {
    const description = (await ctx.invoke('system.operation.describe', { id: 'agent.prompt' })) as {
      inputSchema?: { properties?: Record<string, unknown> }
    }
    properties = description?.inputSchema?.properties
  } catch (error) {
    if (!describeUnavailable(error)) {
      throw error
    }
  }
  const supported = !!properties?.whenBusy
  const input = ctx.input as Record<string, unknown>
  if (input.expectTurnId !== undefined && (!supported || !properties?.expectTurnId)) {
    throw new CliError(
      'cli.unsupported',
      1,
      'This Worker cannot enforce --expect-turn. Nothing was sent.',
      'Use a Worker whose agent.prompt schema describes expectTurnId.',
    )
  }
  const deliveryId = randomUUID()
  const payload = supported
    ? { ...input, whenBusy: ctx.options['if-busy'] ?? 'steer', deliveryId }
    : input
  if (!supported) {
    ctx.io.stderr.write('This Worker cannot steer; busy refusal remains unchanged.\n')
  } else {
    ctx.io.stderr.write(`Sending prompt (delivery ${deliveryId}).\n`)
  }
  try {
    const result = (await ctx.invoke('agent.prompt', payload)) as { phase?: string }
    if (result?.phase === 'dispatched') {
      ctx.io.stderr.write(
        `Typed into Codex while it works; Codex submits it at its next tool call or after the current response; OpenCove confirms it when Codex submits it — check with opencove agent delivery ${deliveryId}.\n`,
      )
    }
    return result
  } catch (error) {
    if (supported && error instanceof CliError) {
      error.details = {
        deliveryId,
        ...(error.details && typeof error.details === 'object' ? error.details : {}),
      }
    }
    throw error
  }
}

/** Recognize only operation-specific capability failures, never transport/auth/input failures. */
function describeUnavailable(error: unknown): boolean {
  if (!(error instanceof CliError)) {
    return false
  }
  const text = (error.debugMessage ?? error.message).replace(
    /^Invalid input for system\.operation\.describe: /,
    '',
  )
  if (error.code === 'common.invalid_input') {
    return [
      'Unknown control surface query: system.operation.describe',
      'Unknown or unregistered operation: system.operation.describe',
      'Unknown operation: system.operation.describe',
    ].includes(text)
  }
  const details = error.details as { operationId?: string; reason?: string } | undefined
  return (
    error.code === 'common.unavailable' &&
    (text === 'Operation unavailable: system.operation.describe' ||
      (details?.operationId === 'system.operation.describe' &&
        details.reason === 'operation_unavailable'))
  )
}
