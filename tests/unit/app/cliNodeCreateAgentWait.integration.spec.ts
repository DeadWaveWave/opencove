import { createAgentWaitArgs } from '../../support/cliNodeCreateAgentWait'
// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { run } from '../../../src/app/cli/core/run'
import { completedPromptFixture } from './cliAgentPromptWait.helpers'
import { node } from './cliIdentity.helpers'
import { snapshot, fixture as eventFixture } from './cliAgentWait.helpers'

afterEach(() => vi.useRealTimers())
const args = [
  'node',
  'create',
  'agent',
  '--space',
  'space-123456',
  '--prompt',
  'hello',
  '--wait',
  '--read',
]
function fixture() {
  const f = completedPromptFixture()
  f.values['node.create'] = {
    revision: 1,
    projectId: 'p',
    spaceId: 'space-123456',
    node: {
      ...node,
      kind: 'agent',
      sessionId: 's',
      data: { kind: 'agent', provider: 'claude-code' },
    },
  }
  return f
}
it('creates once and projects a fast ended initial reply alongside existing create fields', async () => {
  const f = fixture()
  expect(await run([...args, '--fields', 'id,turnId,outcome,reply.message'], f.io)).toBe(0)
  expect(JSON.parse(f.out())).toEqual({
    revision: 1,
    projectId: 'p',
    spaceId: 'space-123456',
    node: { id: node.id },
    turnId: 't',
    outcome: 'completed',
    reply: { message: 'Fast reply' },
  })
  expect(f.requests.filter(r => r.id === 'node.create')).toHaveLength(1)
  expect(f.requests.some(r => r.id === 'agent.prompt')).toBe(false)
  expect(f.requests.find(r => r.id === 'agent.get')?.payload).toEqual({ sessionId: 's' })
})
it.each([
  ['--wait'],
  ['--read'],
  ['--wait', '--prompt', ''],
  ['--wait', '--prompt', '   '],
  ['--wait', '--prompt', 'x', '--timeout', '249ms'],
  ['--wait', '--prompt', 'x', '--timeout', '2147483648ms'],
  ['--wait', '--prompt', 'x', '--fields', 'reply.invalid'],
])('rejects invalid composition before connection: %j', async flags => {
  const f = fixture()
  expect(await run(['node', 'create', 'agent', ...flags], f.io)).toBe(2)
  expect(f.requests).toEqual([])
})
it('quiet waits for completion and emits only the created id', async () => {
  const f = fixture()
  expect(await run([...args, '-q'], f.io)).toBe(0)
  expect(f.out()).toBe(node.id + '\n')
  expect(f.requests.some(r => r.id === 'agent.finalMessage')).toBe(true)
})
it('does not observe without --wait', async () => {
  const f = fixture()
  expect(await run(args.slice(0, -2), f.io)).toBe(0)
  expect(f.requests.some(r => r.id === 'agent.get' || r.id === 'agent.finalMessage')).toBe(false)
})
it('attention preserves blockedSummary and all known IDs without retrying creation', async () => {
  const f = fixture()
  const messages: string[] = []
  const write = f.io.stderr.write
  f.io.stderr.write = text => {
    messages.push(text)
    write(text)
  }
  f.values['agent.get'] = {
    ...snapshot(node.id, 'waiting'),
    sessionId: 's',
    turn: { id: 't', startedAt: 2, start: 'observed' },
    blockedReason: 'question',
    blockedSummary: {
      kind: 'question',
      questions: [{ question: 'Allow access?', options: ['Allow', 'Deny'] }],
    },
  }
  const stream = eventFixture(),
    original = f.io.fetch
  f.io.fetch = (url, init) =>
    String(url).includes('/events?') ? stream.fetch(url) : original(url, init)
  expect(await run(args, f.io)).toBe(10)
  expect(f.error()).toMatchObject({
    retryable: false,
    details: {
      nodeId: node.id,
      sessionId: 's',
      turnId: 't',
      targets: [{ blockedSummary: { kind: 'question' } }],
    },
  })
  // The conditional progress continuation precedes the unchanged error recovery hint.
  expect(messages.filter(text => text.startsWith('Waiting for turn '))).toHaveLength(1)
  expect(
    messages
      .filter(text => !text.startsWith('Waiting for turn '))
      .join('')
      .match(/opencove agent wait --node/g),
  ).toHaveLength(1)
  expect(f.error().message).toBe('The agent needs the user’s approval or input in OpenCove.')
  expect(f.error().hint).toBe(
    `The agent node was created. Do not repeat node create agent. Resume with opencove agent wait --node ${node.id} --turn t.`,
  )
  expect(f.requests.filter(r => r.id === 'node.create')).toHaveLength(1)
  expect(stream.streams[0].cancelled).toBe(true)
})
it('no initial turn times out with IDs and cannot be retried as a create', async () => {
  const f = fixture()
  f.values['agent.get'] = { ...snapshot(node.id), sessionId: 's' }
  expect(await run([...args, '--timeout', '250ms'], f.io)).toBe(124)
  expect(f.error()).toMatchObject({
    code: 'agent.wait_timeout',
    retryable: false,
    message:
      'No first turn was observed before the deadline. Lifecycle telemetry may be unavailable; the agent may still be running or may have finished.',
    hint: expect.stringContaining('Do not recreate the node or resend the prompt'),
    details: { nodeId: node.id, sessionId: 's' },
  })
  expect(f.requests.filter(r => r.id === 'node.create')).toHaveLength(1)
})
it('creation retains its original HTTP timeout even with a short wait budget', async () => {
  vi.useFakeTimers()
  const f = fixture(),
    original = f.io.fetch
  let started = false,
    ended = false
  f.io.fetch = (url, init) => {
    if (JSON.parse(String(init?.body)).id !== 'node.create') {
      return original(url, init)
    }
    started = true
    return new Promise<Response>((_, reject) =>
      init!.signal!.addEventListener(
        'abort',
        () => reject(new DOMException('Aborted', 'AbortError')),
        { once: true },
      ),
    )
  }
  const pending = run([...args, '--timeout', '250ms'], f.io).then(code => {
    ended = true
    return code
  })
  await vi.advanceTimersByTimeAsync(19999)
  expect(started).toBe(true)
  expect(ended).toBe(false)
  await vi.advanceTimersByTimeAsync(1)
  expect(await pending).toBe(124)
  expect(f.error()).toMatchObject({ retryable: false })
  expect(vi.getTimerCount()).toBe(0)
})
it('reveals --focus immediately after creation even when the first turn times out', async () => {
  const f = fixture()
  f.values['agent.get'] = { ...snapshot(node.id), sessionId: 's' }
  expect(await run([...args, '--focus', '--timeout', '250ms'], f.io)).toBe(124)
  const operations = f.requests.map(r => r.id)
  expect(operations.indexOf('canvas.focus')).toBeGreaterThan(operations.indexOf('node.create'))
  expect(operations.indexOf('canvas.focus')).toBeLessThan(operations.indexOf('agent.get'))
})
it('reads --prompt-file before connection and sends only the ordinary creation payload', async () => {
  const f = fixture()
  f.io.readTextFile = vi.fn(async () => 'hello from file')
  const fileArgs = [...args]
  fileArgs.splice(fileArgs.indexOf('--prompt'), 2, '--prompt-file', 'assignment.txt')
  expect(await run(fileArgs, f.io)).toBe(0)
  expect(f.requests.find(r => r.id === 'node.create')!.payload).toEqual({
    kind: 'agent',
    space: { kind: 'spaceId', spaceId: 'space-123456' },
    data: { prompt: 'hello from file' },
  })
})
it('an exact wait timeout retains IDs and is never retryable after creation', async () => {
  const f = fixture()
  f.values['agent.get'] = {
    ...snapshot(node.id),
    sessionId: 's',
    turn: { id: 't', startedAt: 2, start: 'observed' },
  }
  const stream = eventFixture(),
    original = f.io.fetch
  f.io.fetch = (url, init) =>
    String(url).includes('/events?') ? stream.fetch(url) : original(url, init)
  expect(await run([...args, '--timeout', '250ms'], f.io)).toBe(124)
  expect(f.error()).toMatchObject({
    retryable: false,
    details: { nodeId: node.id, sessionId: 's', turnId: 't', reason: 'wait_timeout' },
  })
  expect(f.requests.filter(r => r.id === 'node.create')).toHaveLength(1)
  expect(stream.streams[0].cancelled).toBe(true)
})
it('focus authorization failure retains the created IDs and never retries', async () => {
  const f = fixture(),
    original = f.io.fetch
  f.io.fetch = (url, init) =>
    JSON.parse(String(init?.body)).id === 'canvas.focus'
      ? Promise.resolve(
          new Response(
            JSON.stringify({
              ok: false,
              error: { code: 'common.forbidden', message: 'Focus denied' },
            }),
          ),
        )
      : original(url, init)
  expect(await run([...args, '--focus'], f.io)).toBe(4)
  expect(f.error()).toMatchObject({
    retryable: false,
    details: { nodeId: node.id, sessionId: 's' },
    hint: expect.stringContaining('Do not repeat node create agent'),
  })
  expect(f.requests.filter(r => r.id === 'node.create')).toHaveLength(1)
  expect(f.requests.some(r => r.id === 'agent.get')).toBe(false)
})

it.each(['id', 'node.id', 'id,reply.message', 'reply.message'])(
  'preserves the create envelope for --fields %s',
  async fields => {
    const f = fixture()
    const frame = { x: 10, y: 20, width: 640, height: 480 }
    f.values['node.create'] = {
      ...(f.values['node.create'] as object),
      node: { ...(f.values['node.create'] as { node: object }).node, frame },
    }
    f.values['canvas.focus'] = { delivered: true, deliveredClientCount: 1 }
    expect(
      await run([...args, '--focus', '--frame', JSON.stringify(frame), '--fields', fields], f.io),
    ).toBe(0)
    const output = JSON.parse(f.out())
    expect(output).toEqual({
      revision: 1,
      projectId: 'p',
      spaceId: 'space-123456',
      appliedFrame: frame,
      frameAdjusted: false,
      focus: { delivered: true, deliveredClientCount: 1 },
      focusError: null,
      node: fields.includes('id') ? { id: node.id } : {},
      ...(fields.includes('reply.message') ? { reply: { message: 'Fast reply' } } : {}),
    })
  },
)
it.each(['permission', 'question'])(
  'requests JSON for the %s PTY E2E command even with TTY stderr',
  async blockedReason => {
    const f = fixture()
    f.io.stderr.isTTY = true
    f.values['agent.get'] = {
      ...snapshot(node.id, 'waiting'),
      sessionId: 's',
      blockedReason,
      turn: { id: 't', startedAt: 2, start: 'observed' },
    }
    const stream = eventFixture(),
      original = f.io.fetch
    f.io.fetch = (url, init) =>
      String(url).includes('/events?') ? stream.fetch(url) : original(url, init)
    expect(
      await run(
        [
          ...createAgentWaitArgs(
            'claude-code',
            blockedReason === 'permission' ? 'Permission check' : 'Question check',
          ),
          '--project',
          'project-123456',
        ],
        f.io,
      ),
    ).toBe(10)
    expect(f.error()).toMatchObject({
      code: 'agent.wait_attention',
      details: { targets: [{ blockedReason }] },
    })
  },
)
