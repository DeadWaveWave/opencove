import { setTimeout as delay } from 'node:timers/promises'
import {
  agentRunEventSchema,
  agentRunSnapshotSchema,
} from '../../../shared/contracts/dto/agentRunStateSchema'
import type { AgentRunEvent } from '../../../shared/contracts/dto/agentRunState'
import type { Connection } from './context'
import { agentEvents } from './agentEvents'
import { CliError } from './errors'
import type { TurnWaitResult } from './agentWaitTurn'
import { AgentWaitProjection, type WaitSnapshot } from './agentWaitProjection'
import { presentAgentTurnError } from './agentTurnError'
import { AgentWaitEvidence, agentWaitWatermarkSchema } from './agentWaitEvidence'
import * as z from 'zod'

export type WaitUntil = 'idle' | 'waiting' | 'exited' | 'turn-end'
export interface WaitOptions {
  nodeIds: string[]
  until?: WaitUntil
  turnId?: string
  any: boolean
  timeoutMs: number
  connection: Connection
  fetch: typeof fetch
  signal?: AbortSignal
  query(
    id: 'agent.get' | 'agent.list' | 'agent.finalMessage',
    payload: unknown,
    signal: AbortSignal,
  ): Promise<unknown>
}

type StateWaitResult = {
  until: WaitUntil | undefined
  mode: string
  agents: (WaitSnapshot | { nodeId: string; state: 'unknown' })[]
}
export function waitForAgents(options: WaitOptions & { turnId: string }): Promise<TurnWaitResult>
export function waitForAgents(
  options: WaitOptions & { turnId?: undefined },
): Promise<StateWaitResult>
export function waitForAgents(options: WaitOptions): Promise<StateWaitResult | TurnWaitResult>
/** Worker decisions are authoritative. Local state is only a cursor-fenced projection. */
export async function waitForAgents(
  options: WaitOptions,
): Promise<StateWaitResult | TurnWaitResult> {
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
  const result = () => ({
    until: options.until,
    mode: options.any ? 'any' : 'all',
    agents: nodeIds.map(
      nodeId => projection.snapshot(nodeId) ?? { nodeId, state: 'unknown' as const },
    ),
  })
  let evidence: AgentWaitEvidence | undefined
  const conflicts = new Map<string, Set<string>>()
  let projection = new AgentWaitProjection(nodeIds, options.turnId, conflicts)
  const success = () => {
    const ended = evidence?.result
    const current = projection.snapshot(nodeIds[0])
    return ended
      ? { ...ended, state: current?.sessionId === ended.sessionId ? current.state : ended.state }
      : result()
  }
  const satisfied = () => {
    if (options.turnId !== undefined) {
      return !!evidence?.result
    }
    const matches = nodeIds.map(nodeId => {
      const snapshot = projection.snapshot(nodeId)
      return options.until === 'turn-end'
        ? !!snapshot?.endedTurn
        : snapshot?.state === options.until &&
            (options.until !== 'idle' ||
              (snapshot?.turn === null && snapshot?.quality !== 'degraded'))
    })
    return options.any ? matches.some(Boolean) : matches.every(Boolean)
  }
  const query = async (id: 'agent.get' | 'agent.list' | 'agent.finalMessage', payload: unknown) => {
    controller.signal.throwIfAborted()
    return options.query(id, payload, controller.signal)
  }
  const watermark = async () => agentWaitWatermarkSchema.parse(await query('agent.list', {}))
  const get = (nodeId: string) => query('agent.get', { nodeId })
  try {
    while (!controller.signal.aborted) {
      const baseline = z
        .object({
          ...agentWaitWatermarkSchema.shape,
          agents: z.array(agentRunSnapshotSchema),
          turnArchive: z.boolean().optional(),
        })
        .parse(
          // eslint-disable-next-line no-await-in-loop
          await query('agent.list', {}),
        )
      let cursor = { epoch: baseline.epoch, seq: baseline.seq }
      projection = new AgentWaitProjection(nodeIds, options.turnId, conflicts)
      evidence =
        options.turnId === undefined
          ? undefined
          : new AgentWaitEvidence(options.turnId, query, baseline.turnArchive === true)
      // Only the Worker's binding-aware get resolves owners, including exited sessions.
      // eslint-disable-next-line no-await-in-loop
      await projection.initialize(get)
      // eslint-disable-next-line no-await-in-loop
      projection.reconciliation.defer(await watermark())
      const evaluate = async (event?: AgentRunEvent): Promise<'done' | 'pending' | 'resync'> => {
        const selected = projection.snapshot(nodeIds[0])
        // Retain monotonic identity evidence during replay; success still needs a coherent cursor.
        if (selected) {
          evidence?.retain(selected, event)
        }
        const status = projection.reconciliation.status(cursor)
        if (status !== 'ready') {
          return status
        }
        await evidence?.observe(selected, event, nodeIds[0])
        controller.signal.throwIfAborted()
        if (evidence?.reconcile(cursor)) {
          return 'resync'
        }
        return satisfied() ? 'done' : 'pending'
      }
      // eslint-disable-next-line no-await-in-loop
      const initial = await evaluate()
      if (initial === 'done') {
        return success()
      }
      if (initial === 'resync') {
        continue
      }
      // One global ordered stream reconciles all selected owners to a common cursor.
      const subscription = new AbortController()
      const stop = () => subscription.abort()
      controller.signal.addEventListener('abort', stop, { once: true })
      if (controller.signal.aborted) {
        stop()
      }
      let resync = false
      const watch = async () => {
        while (!subscription.signal.aborted) {
          try {
            // eslint-disable-next-line no-await-in-loop
            for await (const raw of agentEvents({
              ...options,
              nodeId: undefined,
              epoch: cursor.epoch,
              afterSeq: cursor.seq,
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
              if (event.epoch !== cursor.epoch) {
                resync = true
                stop()
                return
              }
              if (event.seq <= cursor.seq) {
                continue
              }
              cursor = { epoch: event.epoch, seq: event.seq }
              const resolutions = projection.resolutions(event)
              if (resolutions.length) {
                const owner = projection.owner(nodeIds[0])
                for (const nodeId of resolutions) {
                  // eslint-disable-next-line no-await-in-loop
                  await projection.resolve(nodeId, get)
                }
                projection.reconciliation.defer(await watermark())
                if (options.turnId !== undefined && owner !== projection.owner(nodeIds[0])) {
                  evidence = new AgentWaitEvidence(
                    options.turnId,
                    query,
                    baseline.turnArchive === true,
                  )
                }
              }
              const applied = projection.apply(event)
              const status = await evaluate(applied ? event : undefined)
              if (status === 'resync') {
                resync = true
                stop()
                return
              }
              if (status === 'done') {
                stop()
                return
              }
            }
          } catch (error) {
            if (subscription.signal.aborted) {
              return
            }
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
      try {
        // eslint-disable-next-line no-await-in-loop
        await watch()
      } finally {
        stop()
        controller.signal.removeEventListener('abort', stop)
      }
      controller.signal.throwIfAborted()
      if (!resync && satisfied()) {
        return success()
      }
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
    if (error instanceof CliError) {
      throw presentAgentTurnError(error, {
        nodeId: nodeIds[0],
        sessionId: projection.snapshot(nodeIds[0])?.sessionId,
        turnId: options.turnId,
      })
    }
    throw error
  } finally {
    clearTimeout(timer)
    controller.abort()
    options.signal?.removeEventListener('abort', interrupt)
  }
}
