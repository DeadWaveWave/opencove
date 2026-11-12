// @vitest-environment node
import { expect, it } from 'vitest'
import { run } from '../../../src/app/cli/core/run'
import { fixture, agent } from './cliAgentMetadata.helpers'
import { space } from './cliIdentity.helpers'

it.each(['node list', 'context'])(
  'session versus work state: %s includes observed terminal run state',
  async command => {
    const f = fixture()
    expect(await run([...command.split(' '), '--space', space.id], f.io)).toBe(0)
    const nodes = JSON.parse(f.out()).nodes
    expect(nodes.find((n: { id: string }) => n.id === 'agent')).toMatchObject({
      sessionStatus: 'running',
      agentState: { state: 'idle', quality: 'authoritative', turnId: null },
    })
    expect(nodes.find((n: { id: string }) => n.id === 'observed')).toMatchObject({
      sessionStatus: 'running',
      agentState: { state: 'working', quality: 'authoritative', turnId: 'turn' },
    })
  },
)

it('session versus work state: displaced observations never become the new session state', async () => {
  const f = fixture()
  f.values['node.list'] = { nodes: [{ ...agent, sessionId: 'replacement' }] }
  expect(
    await run(
      ['node', 'list', '--space', space.id, '--fields', 'id,status,sessionStatus,agentState'],
      f.io,
    ),
  ).toBe(0)
  expect(JSON.parse(f.out()).nodes[0]).toMatchObject({
    status: 'running',
    sessionStatus: 'running',
    agentState: { state: 'unknown', quality: 'degraded', turnId: null },
  })
})

it.each(
  ['node list', 'context'].flatMap(command =>
    ['unsupported', 'generic'].map(failure => [command, failure]),
  ),
)('%s survives optional agent-list failure: %s', async (command, failure) => {
  const f = fixture(),
    original = f.io.fetch
  const notices: string[] = []
  f.io.stderr.write = text => {
    notices.push(text)
  }
  f.io.fetch = async (url, init) => {
    if (JSON.parse(String(init?.body)).id === 'agent.list') {
      if (failure === 'generic') {
        throw new Error('generic metadata failure')
      }
      return new Response(
        JSON.stringify({
          ok: false,
          error: {
            code: 'common.invalid_input',
            debugMessage: 'Unknown control surface query: agent.list',
          },
        }),
      )
    }
    return original(url, init)
  }
  expect(await run([...command.split(' '), '--space', space.id], f.io)).toBe(0)
  const nodes = JSON.parse(f.out()).nodes
  expect(nodes.find((n: { id: string }) => n.id === 'agent')).toMatchObject({
    agentState: { state: 'unknown', quality: 'degraded', turnId: null },
    sessionStatus: 'running',
  })
  expect(nodes.find((n: { id: string }) => n.id === 'observed')).not.toHaveProperty('agentState')
  expect(notices).toHaveLength(1)
  expect(notices[0]).toContain('agent state unavailable')
})
it.each(['node list', 'context'])(
  '%s skips all optional metadata for unrelated explicit fields',
  async command => {
    const f = fixture()
    expect(
      await run(
        [
          ...command.split(' '),
          '--space',
          space.id,
          '--fields',
          command === 'context' ? 'nodes.id,nodes.title' : 'id,title',
        ],
        f.io,
      ),
    ).toBe(0)
    expect(f.requests.filter(r => r.id === 'agent.list')).toHaveLength(0)
    expect(f.requests.filter(r => r.id === 'node.list' && r.payload.kind === 'task')).toHaveLength(
      0,
    )
  },
)

it.each(['node list', 'context'])(
  '%s survives simultaneous optional state and task-link failures with one notice',
  async command => {
    const f = fixture(),
      original = f.io.fetch
    const notices: string[] = []
    f.io.stderr.write = text => {
      notices.push(text)
    }
    f.io.fetch = async (url, init) => {
      const request = JSON.parse(String(init?.body))
      if (
        request.id === 'agent.list' ||
        (request.id === 'node.list' && request.payload.kind === 'task')
      ) {
        throw new Error('metadata offline')
      }
      return original(url, init)
    }
    expect(await run([...command.split(' '), '--space', space.id], f.io)).toBe(0)
    expect(JSON.parse(f.out()).nodes).toHaveLength(3)
    expect(notices).toHaveLength(1)
  },
)
