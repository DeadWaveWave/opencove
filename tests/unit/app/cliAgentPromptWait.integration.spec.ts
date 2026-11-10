// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
afterEach(() => vi.useRealTimers())
import { completedPromptFixture } from './cliAgentPromptWait.helpers'
import { run } from '../../../src/app/cli/core/run'
import { node } from './cliIdentity.helpers'
import { fixture, snapshot } from './cliAgentWait.helpers'

const args = ['agent', 'prompt', '--node', node.id, '--wait', '--read', '--timeout', '2m', 'hello']
it('does not miss an archived fast end before the wait starts; projects the combined JSON', async () => {
  const f = completedPromptFixture()
  expect(await run([...args, '--fields', 'deliveryId,turnId,outcome,reply.message'], f.io)).toBe(0)
  expect(JSON.parse(f.out())).toEqual({
    deliveryId: 'd',
    turnId: 't',
    outcome: 'completed',
    reply: { message: 'Fast reply' },
  })
  const writes = f.requests.filter(r => r.id === 'agent.prompt')
  expect(writes).toHaveLength(1)
  expect(writes[0].payload).toMatchObject({ text: 'hello', timeoutMs: 15000, whenBusy: 'steer' })
  expect(f.requests.at(-1)).toEqual({
    kind: 'query',
    id: 'agent.finalMessage',
    payload: { sessionId: 's', turnId: 't' },
  })
})
it('preserves real attention envelope, summary and delivery IDs with exit 10', async () => {
  const f = completedPromptFixture()
  f.values['agent.get'] = {
    ...snapshot(node.id, 'waiting'),
    sessionId: 's',
    turn: { id: 't', startedAt: 2, start: 'observed' },
    blockedReason: 'permission',
    blockedSummary: {
      kind: 'question',
      questions: [{ question: 'Allow access?', options: ['Allow', 'Deny'] }],
    },
  }
  const stream = fixture()
  const original = f.io.fetch
  f.io.fetch = (url, init) =>
    String(url).includes('/events?') ? stream.fetch(url) : original(url, init)
  expect(await run(args, f.io)).toBe(10)
  expect(f.out()).toBe('')
  expect(f.error()).toMatchObject({
    code: 'agent.wait_attention',
    details: {
      deliveryId: 'd',
      turnId: 't',
      targets: [
        {
          nodeId: node.id,
          blockedSummary: {
            kind: 'question',
            questions: [{ question: 'Allow access?', options: ['Allow', 'Deny'] }],
          },
        },
      ],
    },
  })
  expect(stream.streams[0].cancelled).toBe(true)
})
it('never marks a wait timeout after delivery as retryable, since repeating would resend', async () => {
  const f = completedPromptFixture()
  f.values['agent.get'] = {
    ...snapshot(node.id, 'working'),
    sessionId: 's',
    turn: { id: 't', startedAt: 2, start: 'observed' },
  }
  const stream = fixture()
  const original = f.io.fetch
  f.io.fetch = (url, init) =>
    String(url).includes('/events?') ? stream.fetch(url) : original(url, init)
  expect(
    await run(['agent', 'prompt', '--node', node.id, '--wait', '--timeout', '300ms', 'hello'], f.io),
  ).toBe(124)
  expect(f.out()).toBe('')
  expect(f.error()).toMatchObject({
    code: 'agent.wait_timeout',
    retryable: false,
    details: { deliveryId: 'd', turnId: 't' },
  })
})
it.each([
  ['--read', '--text', 'x'],
  ['--wait', '--text', 'x', '--timeout', '249ms'],
  ['--wait', '--text', 'x', '--timeout', '2147483648ms'],
  ['--wait', '--text', 'x', 'also text'],
  ['--wait', '--text', 'x', '--fields', 'reply.invalid'],
])('invalid input is rejected before sending: %j', async (...flags) => {
  const f = completedPromptFixture()
  expect(await run(['agent', 'prompt', '--node', node.id, ...flags], f.io)).toBe(2)
  expect(f.requests).toEqual([])
})
it('selects the archived delivery turn even after a newer turn starts', async () => {
  const f = completedPromptFixture()
  f.values['agent.get'] = {
    ...snapshot(node.id),
    sessionId: 's',
    turn: { id: 'newer', startedAt: 20, start: 'observed' },
  }
  expect(await run(args, f.io)).toBe(0)
  expect(JSON.parse(f.out())).toMatchObject({
    turnId: 't',
    reply: { turnId: 't', message: 'Fast reply' },
  })
})

it('keeps the prompt HTTP deadline separate from a short wait budget', async () => {
  vi.useFakeTimers()
  const f = completedPromptFixture()
  const original = f.io.fetch
  let sent = false
  let resolved = false
  f.io.fetch = (url, init) => {
    if (JSON.parse(String(init?.body)).id !== 'agent.prompt') {
      return original(url, init)
    }
    sent = true
    return new Promise<Response>((_resolve, reject) => {
      init!.signal!.addEventListener(
        'abort',
        () => reject(new DOMException('Aborted', 'AbortError')),
        { once: true },
      )
    })
  }
  const pending = run(
    ['agent', 'prompt', '--node', node.id, '--wait', '--timeout', '250ms', '--text', 'hello'],
    f.io,
  ).then(code => {
    resolved = true
    return code
  })
  await vi.advanceTimersByTimeAsync(19999)
  expect(sent).toBe(true)
  expect(resolved).toBe(false)
  await vi.advanceTimersByTimeAsync(1)
  expect(await pending).toBe(124)
  expect(f.out()).toBe('')
  expect(f.error()).toMatchObject({ retryable: false, details: { deliveryId: expect.any(String) } })
  expect(vi.getTimerCount()).toBe(0)
})
