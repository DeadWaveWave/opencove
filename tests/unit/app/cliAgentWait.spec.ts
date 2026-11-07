// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { waitForAgents } from '../../../src/app/cli/core/agentWait'
import type { AgentRunSnapshot } from '../../../src/shared/contracts/dto/agentRunState'

const snapshot = (
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
})
function fixture(states = [snapshot()]) {
  let seq = 5
  const streams: { url: URL; send(value: unknown): void; cancelled: boolean }[] = []
  const controller = new AbortController()
  const query = vi.fn(async (id: string, payload: unknown) =>
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
  ) => ({
    type: turnEnd ? 'agent.turn_completed' : 'agent.state_changed',
    epoch: 'epoch',
    seq: eventSeq,
    snapshot: { ...snapshot(nodeId, state), turnOutcome: turnEnd ? 'failed' : null },
    ...(turnEnd ? { endedTurn: { id: 'turn', startedAt: 2, start: 'observed' } } : {}),
  })
  return { wait, streams, controller, query, event, states }
}
afterEach(() => vi.useRealTimers())
it('accepts an already satisfied baseline without subscribing', async () => {
  const f = fixture([snapshot('a', 'idle')])
  expect((await f.wait()).agents[0].state).toBe('idle')
  expect(f.streams).toHaveLength(0)
})
it('subscribes from the baseline and resolves on a later event, closing the stream', async () => {
  const f = fixture(),
    pending = f.wait()
  await vi.waitFor(() => expect(f.streams).toHaveLength(1))
  expect(f.streams[0].url.searchParams.get('afterSeq')).toBe('5')
  expect(f.streams[0].url.searchParams.get('nodeId')).toBe('a')
  f.streams[0].send(f.event())
  expect((await pending).agents[0].state).toBe('idle')
  expect(f.streams[0].cancelled).toBe(true)
})
it('re-baselines on resync using fresh queries', async () => {
  const f = fixture(),
    pending = f.wait()
  await vi.waitFor(() => expect(f.streams).toHaveLength(1))
  f.states[0] = snapshot('a', 'waiting')
  f.streams[0].send({ type: 'resync_required', epoch: 'epoch', seq: 5 })
  await vi.waitFor(() => expect(f.streams).toHaveLength(2))
  expect(f.query.mock.calls.filter(([id]) => id === 'agent.get')).toHaveLength(2)
  f.streams[1].send(f.event())
  expect((await pending).agents[0].state).toBe('idle')
  expect(f.streams.every(s => s.cancelled)).toBe(true)
})
it('times out with 124 and last known state, including degraded idle', async () => {
  vi.useFakeTimers()
  const f = fixture([{ ...snapshot('a', 'idle'), quality: 'degraded' }])
  const pending = f.wait('idle', ['a'], false, 100)
  const assertion = expect(pending).rejects.toMatchObject({
    exitCode: 124,
    details: { lastKnown: { agents: [expect.objectContaining({ quality: 'degraded' })] } },
  })
  await vi.advanceTimersByTimeAsync(100)
  await assertion
  expect(f.streams.every(s => s.cancelled)).toBe(true)
})
it.each([true, false])('supports multiple nodes with any=%s', async any => {
  const f = fixture([snapshot('a'), snapshot('b')]),
    pending = f.wait('idle', ['a', 'b'], any)
  await vi.waitFor(() => expect(f.streams).toHaveLength(2))
  f.streams[0].send(f.event('a'))
  if (!any) {
    let settled = false
    void pending.then(() => {
      settled = true
    })
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(settled).toBe(false)
    f.streams[1].send(f.event('b'))
  }
  expect((await pending).agents).toHaveLength(2)
  expect(f.streams.every(s => s.cancelled)).toBe(true)
})
it('turn-end ignores pre-baseline completions and includes the ended turn and outcome', async () => {
  const f = fixture([snapshot('a', 'idle')]),
    pending = f.wait('turn-end')
  await vi.waitFor(() => expect(f.streams).toHaveLength(1))
  const old = f.event('a', 'idle', true, 5)
  old.endedTurn!.id = 'before-baseline'
  f.streams[0].send(old)
  f.streams[0].send(f.event('a', 'working', false, 6))
  f.streams[0].send(f.event('a', 'idle', true, 7))
  expect((await pending).agents[0]).toMatchObject({
    endedTurn: { id: 'turn' },
    turnOutcome: 'failed',
  })
})
it('interrupts with 130 and cancels readers', async () => {
  const f = fixture(),
    pending = f.wait()
  const assertion = expect(pending).rejects.toMatchObject({ exitCode: 130 })
  await vi.waitFor(() => expect(f.streams).toHaveLength(1))
  f.controller.abort()
  await assertion
  expect(f.streams[0].cancelled).toBe(true)
})

it('reconnects from the accepted cursor after EOF, ignoring duplicate events', async () => {
  const f = fixture(),
    pending = f.wait()
  await vi.waitFor(() => expect(f.streams).toHaveLength(1))
  f.streams[0].send(f.event('a', 'working', false, 8))
  f.streams[0].close()
  await vi.waitFor(() => expect(f.streams).toHaveLength(2))
  expect(f.streams[1].url.searchParams.get('afterSeq')).toBe('8')
  f.streams[1].send(f.event('a', 'idle', false, 7))
  f.streams[1].send(f.event('a', 'idle', false, 9))
  expect((await pending).agents[0].state).toBe('idle')
})
it.each(['waiting', 'exited'] as const)('accepts an already %s baseline', async state => {
  const f = fixture([snapshot('a', state)])
  expect((await f.wait(state)).agents[0].state).toBe(state)
  expect(f.streams).toHaveLength(0)
})
it('retries an unstable baseline rather than replaying a completion before get', async () => {
  const f = fixture([snapshot('a', 'idle')])
  let calls = 0
  const original = f.query.getMockImplementation()!
  f.query.mockImplementation(async (id, payload) =>
    id === 'agent.list'
      ? { epoch: 'epoch', seq: ++calls === 1 ? 4 : 5, agents: [] }
      : original(id, payload),
  )
  const pending = f.wait('turn-end')
  await vi.waitFor(() => expect(f.streams).toHaveLength(1))
  expect(f.query.mock.calls.filter(([id]) => id === 'agent.get')).toHaveLength(2)
  expect(f.streams[0].url.searchParams.get('afterSeq')).toBe('5')
  f.streams[0].send(f.event('a', 'idle', true, 6))
  await pending
})
it('keeps ended outcome separate from later snapshots while waiting for all nodes', async () => {
  const f = fixture([snapshot('a'), snapshot('b')]),
    pending = f.wait('turn-end', ['a', 'b'])
  await vi.waitFor(() => expect(f.streams).toHaveLength(2))
  f.streams[0].send(f.event('a', 'idle', true, 6))
  f.streams[0].send(f.event('a', 'working', false, 7))
  await new Promise(resolve => setTimeout(resolve, 10))
  f.streams[1].send(f.event('b', 'idle', true, 8))
  expect((await pending).agents[0]).toMatchObject({
    state: 'working',
    turnOutcome: null,
    endedTurnOutcome: 'failed',
  })
})
it('refuses missing snapshots with recovery instructions', async () => {
  const f = fixture([])
  await expect(f.wait()).rejects.toMatchObject({
    code: 'agent.not_running',
    hint: expect.stringContaining('start or resume'),
  })
})

it('never accepts unknown as idle', async () => {
  vi.useFakeTimers()
  const f = fixture([snapshot('a', 'unknown')])
  const pending = f.wait('idle', ['a'], false, 10)
  const assertion = expect(pending).rejects.toMatchObject({ exitCode: 124 })
  await vi.advanceTimersByTimeAsync(10)
  await assertion
})
