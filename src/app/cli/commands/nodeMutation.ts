import type { CreateNodeResult } from '../../../shared/contracts/dto/nodeControl'
import type { CommandContext } from '../core/command'
import { CliError } from '../core/errors'
import { retainTurnError, turnContinuation } from '../core/agentTurnComposition'
import { reportNodeFrame } from './nodeFrame'
import { waitForCreatedAgent } from './nodeCreateAgentWait'

async function focusCreatedNode(ctx: CommandContext, value: unknown, wait: boolean) {
  const created = value as CreateNodeResult
  try {
    return {
      ...(value as object),
      focus: await ctx.invoke(
        'canvas.focus',
        {
          target: { kind: 'node', nodeId: created.node.id },
        },
        wait ? { timeoutMs: 20000 } : undefined,
      ),
      focusError: null,
    }
  } catch (error) {
    if (error instanceof CliError && error.exitCode === 1) {
      return {
        ...(value as object),
        focus: null,
        focusError: { code: error.code, debugMessage: error.message },
      }
    }
    if (wait) {
      const ids = { nodeId: created.node.id, sessionId: created.node.sessionId ?? null }
      throw retainTurnError(
        error,
        ids,
        `The agent node was created. Do not repeat node create agent. ${turnContinuation({ nodeId: ids.nodeId })}`,
      )
    }
    throw error
  }
}

/** Preserve creation/placement/focus behavior before starting the optional read-only observer. */
export async function mutateNode(ctx: CommandContext, kind: string, create: boolean) {
  const wait = Boolean(create && kind === 'agent' && ctx.options.wait)
  const result = await ctx.invoke(
    create ? 'node.create' : 'node.update',
    ctx.input,
    wait ? { timeoutMs: 20000 } : undefined,
  )
  let value = reportNodeFrame(result, ctx, kind, create && kind === 'task')
  if (create && ctx.options.focus) {
    value = await focusCreatedNode(ctx, value, wait)
  }
  return wait
    ? waitForCreatedAgent(
        ctx,
        value as CreateNodeResult,
        ctx.io.now() + Number(ctx.options.timeout ?? 20000),
      )
    : value
}
