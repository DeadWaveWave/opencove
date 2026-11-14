import { setTimeout as delay } from 'node:timers/promises'
import { agentRunSnapshotSchema } from '../../../shared/contracts/dto/agentRunStateSchema'
import type { CommandContext } from './command'
import { CliError } from './errors'

/** Session-addressed reads cannot follow a node into a replacement session. */
export async function identifyInitialTurn(
  ctx: CommandContext,
  ids: { nodeId: string; sessionId: string },
  deadline: number,
): Promise<string> {
  const controller = new AbortController()
  const interrupt = () => controller.abort()
  ctx.io.signal?.addEventListener('abort', interrupt, { once: true })
  if (ctx.io.signal?.aborted) {
    interrupt()
  }
  let timedOut = false
  const timer = setTimeout(
    () => {
      timedOut = true
      controller.abort()
    },
    Math.max(0, deadline - ctx.io.now()),
  )
  try {
    while (ctx.io.now() < deadline) {
      controller.signal.throwIfAborted()
      const raw = await ctx.invoke(
        'agent.get',
        { sessionId: ids.sessionId },
        { fresh: true, signal: controller.signal },
      )
      controller.signal.throwIfAborted()
      if (ctx.io.now() >= deadline) {
        break
      }
      const parsed = agentRunSnapshotSchema.nullable().safeParse(raw)
      if (!parsed.success) {
        throw new CliError(
          'agent.stream_invalid',
          5,
          'The agent run state could not be read. Use matching CLI and Worker versions.',
        )
      }
      const snapshot = parsed.data
      if (
        snapshot &&
        snapshot.sessionId === ids.sessionId &&
        (snapshot.nodeId === null || snapshot.nodeId === ids.nodeId)
      ) {
        if (!['claude-code', 'codex'].includes(snapshot.provider)) {
          throw new CliError(
            'agent.wait_unsupported',
            1,
            'Waiting for the initial prompt is supported only for Claude Code and Codex.',
            undefined,
            { reason: 'provider_unsupported', provider: snapshot.provider },
          )
        }
        // A retained end precedes an active next turn on this new session.
        const turnId = snapshot.lastEndedTurn?.id ?? snapshot.turn?.id
        if (turnId) {
          return turnId
        }
        if (snapshot.state === 'exited') {
          throw new CliError(
            'agent.wait_exited',
            11,
            'The agent exited before starting its first turn.',
          )
        }
      }
      await delay(Math.min(100, Math.max(1, deadline - ctx.io.now())), undefined, {
        signal: controller.signal,
      })
    }
    timedOut = true
    throw new Error('Deadline reached')
  } catch (error) {
    if (timedOut) {
      throw new CliError(
        'agent.wait_timeout',
        124,
        'No first turn was observed before the deadline. Lifecycle telemetry may be unavailable; the agent may still be running or may have finished.',
        'Do not recreate the node or resend the prompt. Inspect the existing session before continuing.',
        { reason: 'wait_timeout' },
      )
    }
    if (controller.signal.aborted) {
      throw new CliError(
        'cli.interrupted',
        130,
        'Interrupted while waiting for the agent’s first turn.',
      )
    }
    throw error
  } finally {
    clearTimeout(timer)
    controller.abort()
    ctx.io.signal?.removeEventListener('abort', interrupt)
  }
}
