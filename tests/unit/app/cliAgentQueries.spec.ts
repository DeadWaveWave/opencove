// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { run } from '../../../src/app/cli/core/run'
import { identityFixture, node, who } from './cliIdentity.helpers'
import type { AgentRunSnapshot } from '../../../src/shared/contracts/dto/agentRunState'

const snapshot: AgentRunSnapshot = {
  sessionId: 'session-123456',
  nodeId: node.id,
  provider: 'claude-code',
  state: 'working',
  blockedReason: null,
  turn: { id: 'turn', startedAt: 10, start: 'observed' },
  lastTransitionAt: 10,
  source: 'claude_hook',
  quality: 'authoritative',
  turnOutcome: null,
  lastEndedTurn: null,
}
const finalMessage = {
  sessionId: snapshot.sessionId,
  provider: 'claude-code',
  startedAt: 'now',
  cwd: '/repo',
  resumeSessionId: 'r',
  message: 'Review complete.\n第二行',
}
function fixture(inside = false) {
  const f = identityFixture(inside)
  const originalFetch = f.io.fetch
  f.io.fetch = async (url, init) =>
    JSON.parse(String(init?.body)).id === 'agent.finalMessage'
      ? new Response(
          JSON.stringify({
            ok: false,
            error: {
              code: 'agent.final_message_unavailable',
              details: { reason: 'no_ended_turn' },
            },
          }),
        )
      : originalFetch(url, init)
  f.values['agent.list'] = { epoch: 'e', seq: 5, agents: [snapshot] }
  f.values['agent.get'] = snapshot
  f.values['node.get'] = { node: { ...node, kind: 'agent' } }
  f.values['session.finalMessage'] = finalMessage
  return f
}
it('lists titles and defaults to the caller space, preserving the cursor envelope', async () => {
  const f = fixture(true)
  expect(await run(['agent', 'list', '--state', 'working'], f.io)).toBe(0)
  expect(f.requests.find(r => r.id === 'agent.list')?.payload).toEqual({
    spaceId: who.spaceId,
    state: 'working',
  })
  expect(JSON.parse(f.out())).toEqual({
    epoch: 'e',
    seq: 5,
    agents: [{ ...snapshot, title: 'Shell', taskNodeId: null }],
  })
  expect(f.out()).toMatchSnapshot()
})
it('renders a golden table with all required columns', async () => {
  const f = fixture()
  expect(await run(['agent', 'list', '-o', 'table'], f.io)).toBe(0)
  expect(f.out()).toMatchSnapshot()
})
it('projects agent list fields and accepts explicit space selectors', async () => {
  const f = fixture()
  expect(
    await run(
      ['agent', 'list', '--space', 'Main', '--fields', 'nodeId,title,turn.startedAt'],
      f.io,
    ),
  ).toBe(0)
  expect(f.requests.find(r => r.id === 'agent.list')?.payload.spaceId).toBe(who.spaceId)
  expect(JSON.parse(f.out())).toEqual({
    epoch: 'e',
    seq: 5,
    agents: [{ nodeId: node.id, title: 'Shell', turn: { startedAt: 10 } }],
  })
})
it('supports list project override without defaulting back to own space', async () => {
  const f = fixture(true)
  expect(await run(['agent', 'list', '--project', 'Project'], f.io)).toBe(0)
  expect(f.requests.find(r => r.id === 'agent.list')?.payload).toEqual({ projectId: who.projectId })
})
it.each(['working', 'waiting', 'idle', 'exited', 'unknown'])(
  'forwards state %s without inferring readiness',
  async state => {
    const f = fixture()
    expect(await run(['agent', 'list', '--state', state], f.io)).toBe(0)
    expect(f.requests.find(r => r.id === 'agent.list')?.payload.state).toBe(state)
  },
)
it('gets a snapshot plus title and supports @self', async () => {
  const f = fixture(true)
  expect(await run(['agent', 'get', '--node', '@self'], f.io)).toBe(0)
  expect(f.out()).toMatchSnapshot()
  expect(f.requests.find(r => r.id === 'agent.get')?.payload).toEqual({ nodeId: node.id })
})
it.each([undefined, 'state,title'])(
  'gets an observed terminal agent snapshot (fields=%s)',
  async fields => {
    const f = fixture(true)
    f.values['node.get'] = { node: { ...node, kind: 'terminal' } }
    expect(
      await run(['agent', 'get', '--node', '@self', ...(fields ? ['--fields', fields] : [])], f.io),
    ).toBe(0)
    expect(JSON.parse(f.out())).toEqual(
      fields
        ? { state: snapshot.state, title: 'Shell' }
        : { ...snapshot, title: 'Shell', taskNodeId: null },
    )
  },
)
it('rejects absent get snapshots even with projection', async () => {
  const f = fixture()
  const original = f.io.fetch
  f.io.fetch = async (url, init) =>
    JSON.parse(String(init?.body)).id === 'agent.get'
      ? new Response(JSON.stringify({ ok: true, value: null }))
      : original(url, init)
  expect(await run(['agent', 'get', '--node', 'Shell', '--fields', 'state'], f.io)).toBe(1)
  expect(f.out()).toBe('')
  expect(f.error()).toMatchObject({
    code: 'agent.not_found',
    message: expect.stringContaining('no registered agent run state'),
  })
})
it.each([false, true])('reads plain final text with TTY=%s and --last', async tty => {
  const f = fixture()
  f.io.stdout.isTTY = tty
  expect(await run(['agent', 'read', '--node', 'Shell', '--last'], f.io)).toBe(0)
  expect(f.requests.find(r => r.id === 'session.finalMessage')?.payload).toEqual({
    nodeId: node.id,
  })
  expect(f.out()).toBe(finalMessage.message + '\n')
})
it('preserves structured results for -o json and --fields', async () => {
  const f = fixture()
  expect(await run(['agent', 'read', '--node', 'Shell', '-o', 'json'], f.io)).toBe(0)
  expect(f.out()).toMatchSnapshot()
  const projected = fixture()
  expect(await run(['agent', 'read', '--node', 'Shell', '--fields', 'message'], projected.io)).toBe(
    0,
  )
  expect(JSON.parse(projected.out())).toEqual({ message: finalMessage.message })
})
it.each(['session.transcript_not_ready', 'session.not_found'])(
  'explains %s and next steps',
  async code => {
    const f = fixture(),
      original = f.io.fetch
    f.io.fetch = vi.fn(async (url, init) =>
      JSON.parse(String(init?.body)).id === 'session.finalMessage'
        ? new Response(JSON.stringify({ ok: false, error: { code } }))
        : original(url, init),
    )
    expect(await run(['agent', 'read', '--node', 'Shell'], f.io)).toBe(1)
    expect(f.out()).toBe('')
    expect(f.error()).toMatchObject({
      code,
      hint: expect.stringMatching(/agent wait|start or resume/),
    })
    expect(f.error()).toMatchSnapshot()
  },
)
it('resolves repeated node selectors using the existing scoped lookup policy', async () => {
  const f = fixture(true)
  f.values['node.list'] = { nodes: [node, { ...node, id: 'other-123456', title: 'Other' }] }
  f.values['agent.get'] = { ...snapshot, state: 'idle', turn: null }
  f.values['agent.list'] = { epoch: 'e', seq: 5, agents: [f.values['agent.get']] }
  expect(
    await run(
      [
        'agent',
        'wait',
        '--node',
        '@self',
        '--node',
        'Other',
        '--until',
        'idle',
        '--all',
        '--fields',
        'nodeId,state',
      ],
      f.io,
    ),
  ).toBe(0)
  expect(f.requests.filter(r => r.id === 'agent.get').map(r => r.payload.nodeId)).toEqual([
    node.id,
    'other-123456',
  ])
  expect(JSON.parse(f.out()).agents).toHaveLength(2)
})
it('wait timeout exits 124 with lastKnown on stderr and no stdout', async () => {
  const f = fixture()
  expect(
    await run(['agent', 'wait', '--node', 'Shell', '--until', 'idle', '--timeout', '250ms'], f.io),
  ).toBe(124)
  expect(f.out()).toBe('')
  expect(f.error()).toMatchObject({
    code: 'agent.wait_timeout',
    details: { lastKnown: { agents: [snapshot] } },
  })
})
it.each([
  ['agent', 'list', '--state', 'ready'],
  ['agent', 'wait', '--node', 'x', '--until', 'unknown'],
  ['agent', 'wait', '--node', 'x', '--until', 'idle', '--any', '--all'],
  ['agent', 'wait', '--node', 'x', '--until', 'idle', '--timeout', '0.5ms'],
  ['agent', 'wait', '--until', 'idle'],
  ['agent', 'wait', '--node', 'x'],
  ['agent', 'wait', '--node', 'x', '--turn', 'a', '--until', 'idle'],
  ['agent', 'wait', '--node', 'x', '--turn', 'a', '--any'],
  ['agent', 'wait', '--node', 'x', '--node', 'y', '--turn', 'a'],
  ['agent', 'wait', '--node', 'x', '--node', 'x', '--turn', 'a'],
  ['agent', 'wait', '--node', 'x', '--turn', ''],
  ['agent', 'read', '--node', 'x', '--fields', 'nope'],
])('rejects invalid input before connection: %j', async (...argv) => {
  const f = fixture()
  expect(await run(argv, f.io)).toBe(2)
  expect(f.fetch).not.toHaveBeenCalled()
})
it.each(['list', 'get', 'wait', 'read', ''])(
  'agent %s help is offline and complete',
  async command => {
    const f = fixture()
    expect(await run(['agent', ...(command ? [command] : []), '--help'], f.io)).toBe(0)
    expect(f.fetch).not.toHaveBeenCalled()
    expect(f.out()).toMatchSnapshot()
  },
)

it('prints final wait snapshots with a projectable ended outcome', async () => {
  const f = fixture()
  f.values['agent.get'] = { ...snapshot, state: 'idle', turn: null }
  f.values['agent.list'] = { epoch: 'e', seq: 5, agents: [f.values['agent.get']] }
  expect(await run(['agent', 'wait', '--node', 'Shell', '--until', 'idle'], f.io)).toBe(0)
  expect(f.out()).toMatchSnapshot()
})

it('re-baselines through uncached CLI queries and closes the SSE body on resync', async () => {
  const f = fixture(),
    original = f.io.fetch
  let send!: (text: string) => void
  const cancelled = vi.fn()
  f.io.fetch = vi.fn(async (url, init) =>
    String(url).includes('/events?')
      ? new Response(
          new ReadableStream({
            start(c) {
              send = text => c.enqueue(new TextEncoder().encode(text))
            },
            cancel: cancelled,
          }),
          { headers: { 'content-type': 'text/event-stream' } },
        )
      : original(url, init),
  )
  const pending = run(['agent', 'wait', '--node', 'Shell', '--until', 'idle'], f.io)
  await vi.waitFor(() => expect(send).toBeTypeOf('function'))
  f.values['agent.get'] = { ...snapshot, state: 'idle', turn: null }
  f.values['agent.list'] = { epoch: 'e', seq: 5, agents: [f.values['agent.get']] }
  send('data: {"type":"resync_required","epoch":"e","seq":5}\n\n')
  expect(await pending).toBe(0)
  expect(f.requests.filter(r => r.id === 'agent.list')).toHaveLength(4)
  expect(JSON.parse(f.out()).agents[0].state).toBe('idle')
  expect(cancelled).toHaveBeenCalledOnce()
})

it('refuses repeated @self selectors before discovering profiles without session credentials', async () => {
  const f = fixture()
  f.io.env = {}
  expect(await run(['agent', 'wait', '--node', '@self', '--until', 'idle'], f.io)).toBe(2)
  expect(f.fetch).not.toHaveBeenCalled()
  expect(f.io.readTextFile).not.toHaveBeenCalled()
})

it('renders exact-turn success at the root and projects its fields', async () => {
  const f = fixture()
  f.values['agent.get'] = {
    ...snapshot,
    turn: { ...snapshot.turn!, id: 'newer' },
    lastEndedTurn: { id: 'a', outcome: 'failed', endedAt: 20 },
  }
  f.values['agent.list'] = { epoch: 'e', seq: 5, agents: [f.values['agent.get']] }
  expect(
    await run(
      ['agent', 'wait', '--node', 'Shell', '--turn', 'a', '--fields', 'turnId,outcome,state'],
      f.io,
    ),
  ).toBe(0)
  expect(JSON.parse(f.out())).toEqual({ turnId: 'a', outcome: 'failed', state: 'working' })
})
it('normalizes an older Worker get snapshot with missing lastEndedTurn to null', async () => {
  const f = fixture()
  const { lastEndedTurn: _absent, ...legacy } = snapshot
  f.values['agent.get'] = legacy
  expect(await run(['agent', 'get', '--node', 'Shell', '--fields', 'lastEndedTurn'], f.io)).toBe(0)
  expect(JSON.parse(f.out())).toEqual({ lastEndedTurn: null })
})

it('exact wait preserves the CLI timeout contract during a permission pause', async () => {
  const f = fixture()
  f.values['agent.get'] = { ...snapshot, state: 'waiting', blockedReason: 'permission' }
  f.values['agent.list'] = { epoch: 'e', seq: 5, agents: [f.values['agent.get']] }
  expect(
    await run(['agent', 'wait', '--node', 'Shell', '--turn', 'turn', '--timeout', '250ms'], f.io),
  ).toBe(124)
  expect(f.out()).toBe('')
  expect(f.error()).toMatchObject({
    code: 'agent.wait_timeout',
    details: {
      lastKnown: {
        agents: [
          expect.objectContaining({
            state: 'waiting',
            blockedReason: 'permission',
            turn: expect.objectContaining({ id: 'turn' }),
          }),
        ],
      },
    },
  })
})
it('exact wait gives unknown-turn guidance through the CLI', async () => {
  const f = fixture()
  expect(await run(['agent', 'wait', '--node', 'Shell', '--turn', 'missing'], f.io)).toBe(1)
  expect(f.out()).toBe('')
  expect(f.error()).toMatchObject({
    code: 'agent.wait_turn_unavailable',
    hint: expect.stringContaining('agent get'),
  })
})

it('leaves displaced live sessions untitled and enriches only the current node owner', async () => {
  const f = fixture()
  f.values['agent.list'] = {
    epoch: 'e',
    seq: 9,
    agents: [
      { ...snapshot, sessionId: 'displaced', nodeId: null, state: 'idle' },
      { ...snapshot, sessionId: 'current', nodeId: node.id },
    ],
  }
  expect(await run(['agent', 'list'], f.io)).toBe(0)
  expect(JSON.parse(f.out()).agents).toMatchObject([
    { sessionId: 'displaced', nodeId: null, title: null },
    { sessionId: 'current', nodeId: node.id, title: 'Shell' },
  ])
})
