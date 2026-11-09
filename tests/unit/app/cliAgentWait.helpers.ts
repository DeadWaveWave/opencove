// @vitest-environment node
import { vi } from 'vitest'
import { waitForAgents } from '../../../src/app/cli/core/agentWait'
import type {
  AgentRunEvent,
  AgentRunSnapshot,
} from '../../../src/shared/contracts/dto/agentRunState'

export const snapshot = (
  nodeId = 'a',
  state: AgentRunSnapshot['state'] = 'working',
): AgentRunSnapshot => ({
  nodeId,
  sessionId: `session-${nodeId}`,
  provider: 'claude-code',
  state,
  blockedReason: null,
  turn: null,
  lastTransitionAt: 1,
  source: 'claude_hook',
  quality: 'authoritative',
  turnOutcome: null,
  lastEndedTurn: null,
})
export function fixture(states = [snapshot()]) {
  let seq = 5
  const streams: { url: URL; send(value: unknown): void; close(): void; cancelled: boolean }[] = []
  const controller = new AbortController()
  const query = vi.fn(
    async (id: string, payload: unknown): Promise<unknown> =>
      id === 'agent.list'
        ? { epoch: 'epoch', seq, agents: states }
        : (states.find(s => s.nodeId === (payload as { nodeId: string }).nodeId) ?? null),
  )
  const fetch = vi.fn(async (url: string | URL | Request) => {
    let enqueue!: (chunk: Uint8Array) => void
    let close!: () => void
    const stream = {
      url: new URL(String(url)),
      cancelled: false,
      close() {
        close()
      },
      send(value: unknown) {
        enqueue(new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`))
      },
    }
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        enqueue = chunk => c.enqueue(chunk)
        close = () => c.close()
      },
      cancel() {
        stream.cancelled = true
      },
    })
    streams.push(stream)
    return new Response(body, { headers: { 'content-type': 'text/event-stream' } })
  })
  const wait = (until = 'idle', nodes = ['a'], any = false, timeoutMs = 1000) =>
    waitForAgents({
      nodeIds: nodes,
      until: until as 'idle',
      any,
      timeoutMs,
      connection: { endpoint: 'http://fake', token: 'secret' },
      fetch: fetch as typeof globalThis.fetch,
      signal: controller.signal,
      query,
    })
  const event = (
    nodeId = 'a',
    state: AgentRunSnapshot['state'] = 'idle',
    turnEnd = false,
    eventSeq = ++seq,
  ): AgentRunEvent => ({
    type: turnEnd ? 'agent.turn_completed' : 'agent.state_changed',
    epoch: 'epoch',
    seq: eventSeq,
    snapshot: { ...snapshot(nodeId, state), turnOutcome: turnEnd ? 'failed' : null },
    ...(turnEnd ? { endedTurn: { id: 'turn', startedAt: 2, start: 'observed' } } : {}),
  })
  return { wait, streams, controller, query, event, states, fetch }
}
