import { setTimeout as delay } from 'node:timers/promises'
import {
  agentRunEventSchema,
  agentRunSnapshotSchema,
} from '../../../shared/contracts/dto/agentRunStateSchema'
import type { AgentRunSnapshot, AgentRunEvent } from '../../../shared/contracts/dto/agentRunState'
import type { Connection } from './context'
import { agentEvents } from './agentEvents'
import { CliError } from './errors'
import * as z from 'zod'

const watermarkSchema = z.object({
  epoch: z.string().min(1),
  seq: z.number().int().nonnegative().safe(),
})
export type WaitUntil = 'idle' | 'waiting' | 'exited' | 'turn-end'
type WaitSnapshot = AgentRunSnapshot & {
  endedTurn?: AgentRunEvent['endedTurn']
  endedTurnOutcome?: AgentRunSnapshot['turnOutcome']
}
export interface WaitOptions {
  nodeIds: string[]
  until: WaitUntil
  any: boolean
  timeoutMs: number
  connection: Connection
  fetch: typeof fetch
  signal?: AbortSignal
  query(id: 'agent.get' | 'agent.list', payload: unknown, signal: AbortSignal): Promise<unknown>
}

/** Worker decisions are authoritative. Local state is only a cursor-fenced projection. */
export async function waitForAgents(options: WaitOptions) {
  const controller = new AbortController()
  const interrupt = () => controller.abort()
  options.signal?.addEventListener('abort', interrupt, { once: true })
  if (options.signal?.aborted) {
    interrupt()
  }
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, options.timeoutMs)
  const nodeIds = [...new Set(options.nodeIds)]
  const snapshots = new Map<string, WaitSnapshot>()
  const result = () => ({
    until: options.until,
    mode: options.any ? 'any' : 'all',
    agents: nodeIds.map(nodeId => snapshots.get(nodeId) ?? { nodeId, state: 'unknown' as const }),
  })
  const satisfied = () => {
    const matches = nodeIds.map(nodeId => {
      const s = snapshots.get(nodeId)
      return options.until === 'turn-end'
        ? !!s?.endedTurn
        : s?.state === options.until && (options.until !== 'idle' || s.quality !== 'degraded')
    })
    return options.any ? matches.some(Boolean) : matches.every(Boolean)
  }
  const query = async (id: 'agent.get' | 'agent.list', payload: unknown) => {
    controller.signal.throwIfAborted()
    return options.query(id, payload, controller.signal)
  }
  try {
    while (!controller.signal.aborted) {
      // agent.get has no cursor. Equal surrounding watermarks prove a stable baseline.
      // eslint-disable-next-line no-await-in-loop
      let before = watermarkSchema.parse(await query('agent.list', {}))
      while (true) {
        // eslint-disable-next-line no-await-in-loop
        const values = await Promise.all(nodeIds.map(nodeId => query('agent.get', { nodeId })))
        // eslint-disable-next-line no-await-in-loop
        const after = watermarkSchema.parse(await query('agent.list', {}))
        values.forEach((value, i) => {
          if (value === null) {
            snapshots.delete(nodeIds[i])
            throw new CliError(
              'agent.not_running',
              1,
              `No agent run state for node ${nodeIds[i]}.`,
              'Run opencove node get --node <selector> and start or resume its agent session.',
            )
          }
          snapshots.set(nodeIds[i], agentRunSnapshotSchema.parse(value))
        })
        if (before.epoch === after.epoch && before.seq === after.seq) {
          break
        }
        before = after
      }
      if (satisfied()) {
        return result()
      }
      // One filtered subscription per node: the existing server accepts one nodeId per stream.
      const subscription = new AbortController()
      const stop = () => subscription.abort()
      controller.signal.addEventListener('abort', stop, { once: true })
      if (controller.signal.aborted) {
        stop()
      }
      let resync = false
      const watch = async (nodeId: string) => {
        let seq = before.seq
        while (!subscription.signal.aborted) {
          try {
            // Preserve event ordering within each resumable subscription.
            // eslint-disable-next-line no-await-in-loop
            for await (const raw of agentEvents({
              ...options,
              nodeId,
              epoch: before.epoch,
              afterSeq: seq,
              signal: subscription.signal,
            })) {
              if (subscription.signal.aborted) {
                return
              }
              if (
                raw &&
                typeof raw === 'object' &&
                'type' in raw &&
                raw.type === 'resync_required'
              ) {
                resync = true
                stop()
                return
              }
              const event = agentRunEventSchema.parse(raw)
              if (event.epoch !== before.epoch) {
                resync = true
                stop()
                return
              }
              if (event.seq <= seq) {
                continue
              }
              seq = event.seq
              if (event.snapshot.nodeId !== nodeId) {
                continue
              }
              const previous = snapshots.get(nodeId)
              snapshots.set(nodeId, {
                ...event.snapshot,
                ...(event.type === 'agent.turn_completed'
                  ? { endedTurn: event.endedTurn, endedTurnOutcome: event.snapshot.turnOutcome }
                  : previous?.endedTurn && previous.sessionId === event.snapshot.sessionId
                    ? { endedTurn: previous.endedTurn, endedTurnOutcome: previous.endedTurnOutcome }
                    : {}),
              })
              if (satisfied()) {
                stop()
                return
              }
            }
          } catch (error) {
            if (subscription.signal.aborted) {
              return
            }
            // Protocol/auth failures require explicit recovery. Network EOF/loss resumes its cursor.
            if (error instanceof CliError || error instanceof z.ZodError) {
              throw error
            }
          }
          if (!subscription.signal.aborted) {
            // eslint-disable-next-line no-await-in-loop
            await delay(100, undefined, { signal: subscription.signal }).catch(() => {})
          }
        }
      }
      const watchers = nodeIds.map(watch)
      try {
        // eslint-disable-next-line no-await-in-loop
        await Promise.all(watchers)
      } finally {
        stop()
        // eslint-disable-next-line no-await-in-loop
        await Promise.allSettled(watchers)
        controller.signal.removeEventListener('abort', stop)
      }
      controller.signal.throwIfAborted()
      if (!resync && satisfied()) {
        return result()
      }
      // Lost history cannot certify an unobserved turn end. Re-baseline all selected nodes.
    }
    controller.signal.throwIfAborted()
    throw new Error('Unreachable wait state')
  } catch (error) {
    if (controller.signal.aborted) {
      throw new CliError(
        timedOut ? 'agent.wait_timeout' : 'cli.interrupted',
        timedOut ? 124 : 130,
        timedOut ? 'Timed out waiting for agents.' : 'Agent wait interrupted.',
        'Inspect with opencove agent get --node <selector>; waiting never sends input.',
        { lastKnown: result() },
      )
    }
    if (error instanceof z.ZodError) {
      throw new CliError(
        'agent.stream_invalid',
        5,
        'Invalid agent snapshot or event.',
        'Use matching CLI/Worker versions and inspect agent get.',
      )
    }
    throw error
  } finally {
    clearTimeout(timer)
    controller.abort()
    options.signal?.removeEventListener('abort', interrupt)
  }
}
