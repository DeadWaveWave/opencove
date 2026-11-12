// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { waitForAgents } from '../../../src/app/cli/core/agentWait'
import { continuationFixture, enqueue, dequeue } from '../contexts/claudeTurnContinuation.helpers'

it('exact and idle CLI waits settle only after the queued provider continuation ends', async () => {
  const f = continuationFixture()
  f.registry.bind('s', { nodeId: 'n' })
  f.hook('UserPromptSubmit', 'A')
  let subscribed = 0
  const fetch = async (url: string | URL | Request) => {
    const params = new URL(String(url)).searchParams
    let dispose = () => {}
    return new Response(
      new ReadableStream({
        start(controller) {
          dispose = f.registry.subscribe(
            { epoch: params.get('epoch')!, afterSeq: Number(params.get('afterSeq')) },
            {},
            event => {
              controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`))
            },
          )
          subscribed++
        },
        cancel() {
          dispose()
        },
      }),
      { headers: { 'content-type': 'text/event-stream' } },
    )
  }
  const query = async (id: string, payload: unknown) =>
    id === 'agent.list'
      ? f.registry.list()
      : id === 'agent.get'
        ? f.registry.get(payload as { nodeId: string })
        : f.registry.finalMessage(payload as { sessionId: string; turnId: string })
  const options = {
    nodeIds: ['n'],
    any: false,
    timeoutMs: 2000,
    query,
    fetch: fetch as typeof globalThis.fetch,
    connection: { endpoint: 'http://fake', token: 't' },
  }
  let exactEnded = false,
    idleEnded = false
  const exact = waitForAgents({ ...options, turnId: 't1' }).then(result => {
    exactEnded = true
    return result
  })
  const idle = waitForAgents({ ...options, until: 'idle' }).then(result => {
    idleEnded = true
    return result
  })
  await vi.waitFor(() => expect(subscribed).toBe(2))
  f.record(enqueue)
  f.hook('Stop', 'A', 'intermediate')
  await Promise.resolve()
  expect(exactEnded).toBe(false)
  expect(idleEnded).toBe(false)
  f.record(dequeue)
  f.record({ kind: 'user', promptId: 'B', promptSource: 'queued' })
  await Promise.resolve()
  expect(exactEnded).toBe(false)
  expect(idleEnded).toBe(false)
  f.hook('Stop', 'B', 'final')
  expect(await exact).toMatchObject({ turnId: 't1', outcome: 'completed', state: 'idle' })
  expect((await idle).agents[0]).toMatchObject({ state: 'idle', turn: null })
  expect(f.read({ turnId: 't1' })).toMatchObject({ message: 'final' })
  f.runtime.dispose()
})
