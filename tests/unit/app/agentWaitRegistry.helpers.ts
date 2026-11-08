// @vitest-environment node
import { vi } from 'vitest'
import { AgentRunStateRegistry } from '../../../src/contexts/agent/application/AgentRunStateRegistry'
import { waitForAgents } from '../../../src/app/cli/core/agentWait'
import { CliError } from '../../../src/app/cli/core/errors'
import type {
  AgentRunEvent,
  AgentRunSnapshot,
} from '../../../src/shared/contracts/dto/agentRunState'

export function registryWaitFixture(legacy = false, staleBindings = false) {
  let time = 100,
    sequence = 0,
    turn = 0
  const registry = new AgentRunStateRegistry({
    epoch: 'e',
    now: () => time,
    createTurnId: () => `t${++turn}`,
    schedule: () => () => {},
  })
  registry.register({ sessionId: 's', nodeId: 'n', incarnation: 'i', provider: 'codex' })
  const observe = (state: AgentRunSnapshot['state'], boundary?: 'start' | 'completed' | 'failed') =>
    registry.observe('s', {
      incarnation: 'i',
      source: 'codex_hook',
      sourceSequence: ++sequence,
      observedAt: ++time,
      state,
      ...(boundary
        ? {
            boundary:
              boundary === 'start'
                ? { kind: 'start', evidence: 'task_started' }
                : { kind: 'end', outcome: boundary },
          }
        : {}),
    })
  const wire = (value: unknown) =>
    JSON.parse(
      JSON.stringify(value, function (this: { sessionId?: string }, key, v) {
        if (legacy && key === 'lastEndedTurn') {
          return undefined
        }
        if (staleBindings && key === 'nodeId' && this.sessionId === 's' && v === null) {
          return 'n'
        }
        return v
      }),
    )
  const query = vi.fn(async (id: string, payload: unknown): Promise<unknown> => {
    if (id === 'agent.list') {
      return wire(registry.list())
    }
    if (id === 'agent.get') {
      return wire(registry.get(payload as { nodeId: string }))
    }
    try {
      return registry.finalMessage(payload as { sessionId: string; turnId: string })
    } catch (error) {
      const value = error as { code: string; details: unknown }
      throw new CliError(value.code, 1, 'Unavailable', undefined, value.details)
    }
  })
  let onSubscribe = () => {}
  const events: AgentRunEvent[] = []
  const fetch = vi.fn(async (url: string | URL | Request) => {
    onSubscribe()
    const params = new URL(String(url)).searchParams
    let unsubscribe = () => {}
    return new Response(
      new ReadableStream({
        start(controller) {
          unsubscribe = registry.subscribe(
            { epoch: params.get('epoch')!, afterSeq: Number(params.get('afterSeq')) },
            params.has('nodeId') ? { nodeId: params.get('nodeId')! } : {},
            event => {
              if (event.type !== 'resync_required') {
                events.push(event)
              }
              controller.enqueue(
                new TextEncoder().encode(`data: ${JSON.stringify(wire(event))}\n\n`),
              )
            },
          )
        },
        cancel() {
          unsubscribe()
        },
      }),
      { headers: { 'content-type': 'text/event-stream' } },
    )
  })
  const wait = (turnId?: string) =>
    waitForAgents({
      nodeIds: ['n'],
      turnId,
      until: turnId ? undefined : 'idle',
      any: false,
      timeoutMs: 300,
      query,
      fetch: fetch as typeof globalThis.fetch,
      connection: { endpoint: 'http://fake', token: 't' },
    })
  return {
    registry,
    observe,
    query,
    fetch,
    wait,
    events,
    onSubscribe: (callback: () => void) => {
      onSubscribe = callback
    },
  }
}
