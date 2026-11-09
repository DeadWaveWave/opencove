// @vitest-environment node
import { expect, it } from 'vitest'
import { run } from '../../../src/app/cli/core/run'
import { identityFixture, node } from './cliIdentity.helpers'

function fixture(kind = 'agent', sessionId: string | null = 'session') {
  const f = identityFixture()
  f.values['node.get'] = { node: { ...node, kind, sessionId } }
  f.values['agent.get'] = { nodeId: node.id, sessionId, state: 'idle' }
  f.values['session.stopNode'] = { nodeId: node.id, sessionId, requested: true, stopped: true }
  return f
}

it.each(['agent', 'terminal'])(
  'stops a named %s using its captured session binding',
  async kind => {
    const f = fixture(kind)
    expect(await run(['agent', 'stop', '--node', 'Shell'], f.io)).toBe(0)
    expect(JSON.parse(f.out())).toEqual({ nodeId: node.id, sessionId: 'session', stopped: true })
    expect(f.requests.find(r => r.id === 'session.stopNode')).toMatchObject({
      payload: { nodeId: node.id, sessionId: 'session' },
    })
    expect(
      f.requests.some(r => ['session.kill', 'session.writeNode', 'node.delete'].includes(r.id)),
    ).toBe(false)
  },
)

it('returns an idempotent result from the session owner', async () => {
  const f = fixture()
  f.values['session.stopNode'] = { requested: false, stopped: false, reason: 'not_running' }
  expect(await run(['agent', 'stop', '--node', 'Shell'], f.io)).toBe(0)
  expect(JSON.parse(f.out())).toEqual({
    nodeId: node.id,
    sessionId: 'session',
    stopped: false,
    reason: 'not_running',
  })
})

it.each([null])('refuses a terminal without a matching observed agent: %j', async snapshot => {
  const f = fixture('terminal')
  f.values['agent.get'] = snapshot
  expect(await run(['agent', 'stop', '--node', 'Shell'], f.io)).toBe(1)
  expect(f.out()).toBe('')
  expect(f.error().hint).toContain('session kill')
  expect(f.requests.some(r => r.id === 'session.stopNode')).toBe(false)
})

it('preserves a binding change error instead of reporting not_running', async () => {
  const f = fixture()
  const fetch = f.io.fetch
  f.io.fetch = async (url, init) =>
    JSON.parse(String(init?.body)).id === 'session.stopNode'
      ? new Response(
          JSON.stringify({
            ok: false,
            error: {
              code: 'common.invalid_input',
              debugMessage: 'Node session changed before stop; read it again.',
            },
          }),
        )
      : fetch(url, init)
  expect(await run(['agent', 'stop', '--node', 'Shell'], f.io)).toBe(2)
  expect(f.out()).toBe('')
  expect(f.error().message).toContain('changed')
})

it('requires --node and provides offline help', async () => {
  const f = fixture()
  expect(await run(['agent', 'stop'], f.io)).toBe(2)
  expect(f.fetch).not.toHaveBeenCalled()
  expect(await run(['agent', 'stop', '--help'], f.io)).toBe(0)
  expect(f.out()).toContain('not_running')
  expect(f.fetch).not.toHaveBeenCalled()
})

it('reports a terminal rebind as exit 2 with an inspect hint, never a shell-kill hint', async () => {
  const f = fixture('terminal')
  f.values['agent.get'] = { nodeId: node.id, sessionId: 'replacement', state: 'idle' }
  expect(await run(['agent', 'stop', '--node', 'Shell'], f.io)).toBe(2)
  expect(f.out()).toBe('')
  expect(f.error().code).toBe('common.invalid_input')
  expect(f.error().hint).toContain('node get')
  expect(f.error().hint).not.toContain('session kill')
  expect(f.requests.some(r => r.id === 'session.stopNode')).toBe(false)
})

it('does not send a stop request for an exited terminal agent retained on a surviving shell', async () => {
  const f = fixture('terminal')
  f.values['agent.get'] = { nodeId: node.id, sessionId: 'session', state: 'exited' }
  expect(await run(['agent', 'stop', '--node', 'Shell'], f.io)).toBe(0)
  expect(JSON.parse(f.out())).toEqual({
    nodeId: node.id,
    sessionId: 'session',
    stopped: false,
    reason: 'not_running',
  })
  expect(f.requests.some(r => r.id === 'session.stopNode')).toBe(false)
})

it('requires the Worker to check agent eligibility on every live stop', async () => {
  const f = fixture('terminal')
  expect(await run(['agent', 'stop', '--node', 'Shell'], f.io)).toBe(0)
  expect(f.requests.find(r => r.id === 'session.stopNode')?.payload).toMatchObject({
    agentOnly: true,
  })
})

it('resolves the full literal name that the canvas displays', async () => {
  const f = fixture()
  const named = { ...node, kind: 'agent', sessionId: 'session', title: 'codex · Reviewer' }
  f.values['node.list'] = { nodes: [named] }
  f.values['node.get'] = { node: named }
  expect(await run(['agent', 'stop', '--node', 'codex · Reviewer'], f.io)).toBe(0)
  expect(f.requests.find(r => r.id === 'session.stopNode')?.payload).toMatchObject({
    nodeId: node.id,
    sessionId: 'session',
  })
})

it('refuses an older Worker that cannot enforce agent-only stopping', async () => {
  const f = fixture('terminal')
  f.values['system.operation.describe'] = {
    inputSchema: { anyOf: [{ properties: { nodeId: {}, sessionId: {} } }] },
  }
  expect(await run(['agent', 'stop', '--node', 'Shell'], f.io)).toBe(5)
  expect(f.requests.some(r => r.id === 'session.stopNode')).toBe(false)
  expect(f.error().hint).toContain('Update')
})
