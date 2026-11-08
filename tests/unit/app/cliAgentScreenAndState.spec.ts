// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { run } from '../../../src/app/cli/core/run'
import { identityFixture, node } from './cliIdentity.helpers'

const runState = {
  nodeId: node.id,
  sessionId: 'agent-session',
  provider: 'claude-code',
  state: 'idle',
  turn: null,
  turnOutcome: 'completed',
  blockedReason: null,
  quality: 'authoritative',
  lastTransitionAt: 1,
  source: 'claude_hook',
}
function fixture() {
  const f = identityFixture()
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
  f.values['session.get'] = { nodeId: node.id, sessionId: 'agent-session' }
  f.values['session.presentationSnapshot'] = {
    sessionId: 'agent-session',
    cols: 80,
    rows: 60,
    bufferKind: 'normal',
    serializedScreen: '\x1b[31mHeader\x1b[0m\r\n\r\n  Draft: hello\r\nAllow?\r\n \t\r\n',
  }
  f.values['agent.list'] = { epoch: 'e', seq: 1, agents: [runState] }
  f.values['agent.get'] = runState
  return f
}
it('reads the screen as text, stripping ANSI and trailing blank lines before tailing', async () => {
  const f = fixture()
  expect(await run(['agent', 'read', '--node', '@self', '--screen', '--lines', '3'], f.io)).toBe(0)
  expect(f.out()).toBe('\n  Draft: hello\nAllow?\n')
  expect(f.out()).toMatchSnapshot()
  expect(f.requests.filter(r => r.id.startsWith('session.'))).toEqual([
    { id: 'session.get', kind: 'query', payload: { nodeId: node.id } },
    { id: 'session.presentationSnapshot', kind: 'query', payload: { sessionId: 'agent-session' } },
  ])
})
it('defaults to the last 40 screen lines and returns node/session IDs in JSON mode', async () => {
  const f = fixture()
  f.values['session.presentationSnapshot'] = {
    sessionId: 'agent-session',
    cols: 80,
    rows: 60,
    bufferKind: 'normal',
    serializedScreen: Array.from({ length: 45 }, (_, i) => `Line ${i}`).join('\r\n') + '\r\n\r\n',
  }
  expect(await run(['agent', 'read', '--node', '@self', '--screen', '-o', 'json'], f.io)).toBe(0)
  const result = JSON.parse(f.out())
  expect(result).toEqual({
    nodeId: node.id,
    sessionId: 'agent-session',
    lines: Array.from({ length: 40 }, (_, i) => `Line ${i + 5}`),
  })
})
it('supports screen field projection and an entirely blank screen', async () => {
  const f = fixture()
  f.values['session.presentationSnapshot'] = {
    sessionId: 'agent-session',
    cols: 80,
    rows: 60,
    bufferKind: 'normal',
    serializedScreen: '\x1b[2J\n  \n',
  }
  expect(
    await run(['agent', 'read', '--node', '@self', '--screen', '--fields', 'nodeId,lines'], f.io),
  ).toBe(0)
  expect(JSON.parse(f.out())).toEqual({ nodeId: node.id, lines: [] })
})
it.each([
  ['--lines', '3'],
  ['--screen', '--last'],
  ['--screen', '--lines', '0'],
  ['--screen', '--lines=-1'],
  ['--screen', '--lines', '1.5'],
  ['--screen', '--fields', 'message'],
  ['--fields', 'lines'],
])('rejects incompatible read options before any lookup: %j', async (...flags) => {
  const f = fixture()
  expect(await run(['agent', 'read', '--node', '@self', ...flags], f.io)).toBe(2)
  expect(f.fetch).not.toHaveBeenCalled()
})
it.each(['1ms', '249ms', '0ms'])(
  'rejects wait budget %s before resolving a target',
  async budget => {
    const f = fixture()
    expect(
      await run(['agent', 'wait', '--node', '@self', '--until', 'idle', '--timeout', budget], f.io),
    ).toBe(2)
    expect(f.error().message).toMatch(/250ms/)
    expect(f.fetch).not.toHaveBeenCalled()
  },
)
it('accepts the minimum 250ms wait budget', async () => {
  const f = fixture()
  expect(
    await run(['agent', 'wait', '--node', '@self', '--until', 'idle', '--timeout', '250ms'], f.io),
  ).toBe(0)
})
it.each(['idle', 'working', 'waiting', 'exited', 'unknown'])(
  'context separates agent state %s from lifecycle',
  async state => {
    const f = fixture()
    f.values['node.list'] = {
      nodes: [
        node,
        { ...node, id: 'reviewer', kind: 'agent', title: 'Reviewer', status: 'running' },
      ],
    }
    f.values['agent.list'] = {
      epoch: 'e',
      seq: 1,
      agents: [{ ...runState, nodeId: 'reviewer', state }],
    }
    expect(
      await run(['context', '--fields', 'nodes.id,nodes.state,nodes.sessionStatus'], f.io),
    ).toBe(0)
    expect(JSON.parse(f.out()).nodes).toEqual([{ id: 'reviewer', state, sessionStatus: 'running' }])
    expect(f.requests.find(r => r.id === 'agent.list')?.payload).toEqual({
      spaceId: 'space-123456',
    })
  },
)
it('context never treats a missing run observation as readiness', async () => {
  const f = fixture()
  f.values['node.list'] = { nodes: [{ ...node, id: 'reviewer', kind: 'agent', status: 'running' }] }
  f.values['agent.list'] = { epoch: 'e', seq: 1, agents: [] }
  expect(await run(['context'], f.io)).toBe(0)
  expect(JSON.parse(f.out()).nodes[0]).toMatchObject({ state: 'unknown', sessionStatus: 'running' })
})
it.each(['idle', 'working', 'waiting', 'unknown'])(
  'transcript recovery reflects state %s',
  async state => {
    const f = fixture(),
      original = f.io.fetch
    f.values['agent.get'] = { ...runState, state }
    f.io.fetch = vi.fn(async (url, init) =>
      JSON.parse(String(init?.body)).id === 'session.finalMessage'
        ? new Response(
            JSON.stringify({ ok: false, error: { code: 'session.transcript_not_ready' } }),
          )
        : original(url, init),
    )
    expect(await run(['agent', 'read', '--node', '@self'], f.io)).toBe(1)
    const error = f.error()
    expect(error.code).toBe('session.transcript_not_ready')
    expect(error.hint).toContain('--screen')
    if (state === 'idle') {
      expect(error.message).toContain('provider has not written a readable transcript')
      expect(error.hint).toContain('transcript saving')
      expect(error.hint).not.toContain('wait')
      expect(error).toMatchSnapshot()
    } else if (state === 'working') {
      expect(error.hint).toContain('--until idle')
    } else {
      expect(error.hint).not.toContain('agent wait')
    }
    expect(f.out()).toBe('')
  },
)

it('strips OSC hyperlinks, handles Unicode and keeps a JSON screen golden', async () => {
  const f = fixture()
  f.values['session.presentationSnapshot'] = {
    sessionId: 'agent-session',
    cols: 80,
    rows: 60,
    bufferKind: 'normal',
    serializedScreen: '\x1b]8;;https://example.test\x1b\\你好🙂\x1b]8;;\x1b\\\r\nReady\r\n\r\n',
  }
  expect(await run(['agent', 'read', '--node', '@self', '--screen', '-o', 'json'], f.io)).toBe(0)
  expect(f.out()).toMatchSnapshot()
  expect(JSON.parse(f.out()).lines).toEqual(['你好🙂', 'Ready'])
})
it('reports screen-not-found with a start/resume hint instead of reading a transcript', async () => {
  const f = fixture(),
    original = f.io.fetch
  f.io.fetch = async (url, init) =>
    JSON.parse(String(init?.body)).id === 'session.presentationSnapshot'
      ? new Response(JSON.stringify({ ok: false, error: { code: 'session.not_found' } }))
      : original(url, init)
  expect(await run(['agent', 'read', '--node', '@self', '--screen'], f.io)).toBe(1)
  expect(f.error()).toMatchObject({
    code: 'session.not_found',
    message: 'No current terminal screen was found for this node.',
    hint: expect.stringContaining('start or resume'),
  })
  expect(f.requests.some(r => r.id === 'session.finalMessage')).toBe(false)
})
it('preserves the transcript error if its diagnostic run-state query fails', async () => {
  const f = fixture(),
    original = f.io.fetch
  f.io.fetch = async (url, init) =>
    ['session.finalMessage', 'agent.get'].includes(JSON.parse(String(init?.body)).id)
      ? new Response(
          JSON.stringify({
            ok: false,
            error: {
              code:
                JSON.parse(String(init?.body)).id === 'agent.get'
                  ? 'worker.unavailable'
                  : 'session.transcript_not_ready',
            },
          }),
        )
      : original(url, init)
  expect(await run(['agent', 'read', '--node', '@self'], f.io)).toBe(1)
  expect(f.error()).toMatchObject({
    code: 'session.transcript_not_ready',
    hint: expect.stringContaining('--screen'),
  })
  expect(f.error().hint).not.toContain('agent wait')
})
it.each(['agent.blocked', 'agent.prompt_interrupted', 'agent.prompt_stalled'])(
  'points %s recovery to screen inspection',
  async code => {
    const f = fixture(),
      original = f.io.fetch
    f.io.fetch = async (url, init) =>
      JSON.parse(String(init?.body)).id === 'agent.prompt'
        ? new Response(
            JSON.stringify({
              ok: false,
              error: {
                code,
                details: {
                  pasteDispatchAttempted: code !== 'agent.blocked',
                  submitDispatchAttempted: code === 'agent.prompt_stalled',
                },
              },
            }),
          )
        : original(url, init)
    expect(await run(['agent', 'prompt', '--node', '@self', '--text', 'Review'], f.io)).toBe(1)
    expect(f.error().hint).toContain('opencove agent read --node <selector> --screen')
    if (code === 'agent.prompt_stalled') {
      expect(f.error().hint).toContain('Do not resend.')
    }
  },
)
it('keeps terminal lifecycle state unchanged in context', async () => {
  const f = fixture()
  f.values['node.list'] = { nodes: [{ ...node, id: 'other-terminal', title: 'Build' }] }
  expect(await run(['context'], f.io)).toBe(0)
  expect(JSON.parse(f.out()).nodes).toEqual([
    {
      id: 'other-terminal',
      kind: 'terminal',
      title: 'Build',
      state: 'running',
      sessionStatus: 'running',
      // Same reverse-link field as node list; no task points at this terminal.
      taskNodeId: null,
    },
  ])
  expect(f.requests.some(r => r.id === 'agent.list')).toBe(true)
})
