// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { agentEvents } from '../../../src/app/cli/core/agentEvents'

function fixture(chunks: Uint8Array[], status = 200, contentType = 'text/event-stream') {
  const cancel = vi.fn()
  const fetch = vi.fn(
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            chunks.forEach(chunk => controller.enqueue(chunk))
            controller.close()
          },
          cancel,
        }),
        { status, headers: { 'content-type': contentType } },
      ),
  )
  const controller = new AbortController()
  const events = () =>
    agentEvents({
      connection: { endpoint: 'http://fake', token: 'secret' },
      nodeId: 'node-123',
      epoch: 'epoch',
      afterSeq: 5,
      fetch: fetch as typeof globalThis.fetch,
      signal: controller.signal,
    })
  return { events, fetch, cancel }
}
it.each(['\n', '\r', '\r\n'])(
  'parses UTF-8 fragments, multiline data and comments with %j framing',
  async newline => {
    const bytes = new TextEncoder().encode(
      [
        '\uFEFF:keepalive',
        'event: agent.state_changed',
        'id: epoch:6',
        'data: {',
        'data: "title": "你好🙂"}',
        '',
        'data: {"discard":"unterminated"}',
      ].join(newline),
    )
    const f = fixture([...bytes].map(byte => Uint8Array.of(byte)))
    const values: unknown[] = []
    for await (const event of f.events()) {
      values.push(event)
    }
    expect(values).toEqual([{ title: '你好🙂' }])
    expect(f.fetch.mock.calls[0][1].headers).toMatchObject({
      authorization: 'Bearer secret',
      accept: 'text/event-stream',
    })
  },
)
it('does not trust malformed JSON and cancels the body', async () => {
  const f = fixture([new TextEncoder().encode('data: broken\n\n')])
  await expect(f.events().next()).rejects.toMatchObject({
    code: 'agent.stream_invalid',
    exitCode: 5,
  })
})
it.each([401, 403, 500])('maps stream HTTP %s errors', async status => {
  const f = fixture([], status)
  await expect(f.events().next()).rejects.toMatchObject({
    code: 'agent.stream_failed',
    exitCode: status === 500 ? 1 : 4,
  })
})
it('rejects a successful non-SSE response', async () => {
  const f = fixture([], 200, 'application/json')
  await expect(f.events().next()).rejects.toMatchObject({ code: 'agent.stream_failed' })
})
it('applies the UTF-8 byte bound per frame rather than per network chunk', async () => {
  const encoder = new TextEncoder()
  const payload = 'x'.repeat(400000)
  const f = fixture([
    encoder.encode(
      [1, 2, 3].map(index => `data: ${JSON.stringify({ index, payload })}\n\n`).join(''),
    ),
  ])
  const values = []
  for await (const value of f.events()) {
    values.push(value)
  }
  expect(values).toEqual([1, 2, 3].map(index => ({ index, payload })))
  const oversized = fixture([
    encoder.encode(`data: ${JSON.stringify({ payload: '你'.repeat(400000) })}\n\n`),
  ])
  await expect(oversized.events().next()).rejects.toMatchObject({ exitCode: 5 })
})
