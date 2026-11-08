// @vitest-environment node
import { expect, it } from 'vitest'
import { run } from '../../../src/app/cli/core/run'
import { fixture, agent, task } from './cliAgentMetadata.helpers'
import { space } from './cliIdentity.helpers'

it.each(['agent get', 'agent list', 'context', 'node list'])(
  'reverse task link: %s uses task-owned pointer',
  async command => {
    const f = fixture()
    f.values['node.get'] = { node: agent }
    f.values['agent.get'] = (f.values['agent.list'] as { agents: unknown[] }).agents[0]
    const args = command === 'agent get' ? ['--node', 'agent'] : ['--space', space.id]
    expect(await run([...command.split(' '), ...args], f.io)).toBe(0)
    const result = JSON.parse(f.out())
    const row =
      command === 'context' || command === 'node list'
        ? result.nodes.find((n: { id: string }) => n.id === 'agent')
        : command === 'agent list'
          ? result.agents[0]
          : result
    expect(row.taskNodeId).toBe('task')
    expect(f.requests.filter(r => r.id === 'node.get' && r.payload.nodeId === 'task')).toHaveLength(
      0,
    )
  },
)

it('reverse task link: ambiguous forward pointers do not pick an arbitrary task', async () => {
  const f = fixture()
  f.values['node.list'] = { nodes: [task, { ...task, id: 'task2' }, agent] }
  f.values['node.get'] = { node: { ...agent, data: { kind: 'agent', taskId: 'stale' } } }
  f.values['agent.get'] = (f.values['agent.list'] as { agents: unknown[] }).agents[0]
  expect(await run(['agent', 'get', '--node', 'agent'], f.io)).toBe(0)
  expect(JSON.parse(f.out()).taskNodeId).toBeNull()
})

it.each(['agent list', 'context'])(
  'reverse task link: %s queries tasks across the target project',
  async command => {
    const f = fixture()
    f.values['node.get'] = { node: agent }
    const original = f.io.fetch
    f.io.fetch = async (url, init) => {
      const request = JSON.parse(String(init?.body))
      if (request.id === 'node.list' && request.payload.kind === 'task') {
        expect(request.payload.projectId).toBe(agent.projectId)
        expect(request.payload.space).toBeUndefined()
        return new Response(JSON.stringify({ ok: true, value: { nodes: [task] } }))
      }
      if (request.id === 'node.list') {
        return new Response(JSON.stringify({ ok: true, value: { nodes: [agent] } }))
      }
      return original(url, init)
    }
    expect(await run([...command.split(' '), '--space', space.id], f.io)).toBe(0)
    const result = JSON.parse(f.out())
    expect(command === 'context' ? result.nodes[0].taskNodeId : result.agents[0].taskNodeId).toBe(
      'task',
    )
  },
)

it('node-list task links: agent and terminal projections require only one project-wide join', async () => {
  const f = fixture(),
    original = f.io.fetch
  const terminal = { ...agent, id: 'terminal', kind: 'terminal', sessionId: 'terminal-s' }
  const requests: { id: string; payload: Record<string, unknown> }[] = []
  f.io.fetch = async (url, init) => {
    const request = JSON.parse(String(init?.body))
    requests.push(request)
    if (request.id === 'node.list') {
      return new Response(
        JSON.stringify({
          ok: true,
          value: {
            projectId: agent.projectId,
            nodes:
              request.payload.kind === 'task'
                ? [task, { ...task, id: 'terminal-task', data: { linkedAgentNodeId: terminal.id } }]
                : [agent, terminal],
          },
        }),
      )
    }
    return original(url, init)
  }
  expect(await run(['node', 'list', '--space', space.id, '--fields', 'id,taskNodeId'], f.io)).toBe(
    0,
  )
  expect(JSON.parse(f.out()).nodes).toEqual([
    { id: 'agent', taskNodeId: 'task' },
    { id: 'terminal', taskNodeId: 'terminal-task' },
  ])
  expect(requests.filter(r => r.id === 'agent.list')).toHaveLength(0)
  expect(requests.filter(r => r.id === 'node.get')).toHaveLength(0)
  expect(requests.filter(r => r.id === 'node.list' && r.payload.kind === 'task')).toEqual([
    { id: 'node.list', kind: 'query', payload: { projectId: agent.projectId, kind: 'task' } },
  ])
})

it('context task links: a task-only projection keeps terminal links without querying agent state', async () => {
  const f = fixture(),
    original = f.io.fetch
  const terminal = { ...agent, id: 'terminal', kind: 'terminal', sessionId: 'terminal-s' }
  const requests: { id: string; payload: Record<string, unknown> }[] = []
  f.io.fetch = async (url, init) => {
    const request = JSON.parse(String(init?.body))
    requests.push(request)
    if (request.id === 'node.list') {
      return new Response(
        JSON.stringify({
          ok: true,
          value: {
            projectId: agent.projectId,
            nodes:
              request.payload.kind === 'task'
                ? [{ ...task, id: 'terminal-task', data: { linkedAgentNodeId: terminal.id } }]
                : [terminal],
          },
        }),
      )
    }
    return original(url, init)
  }
  expect(
    await run(['context', '--space', space.id, '--fields', 'nodes.id,nodes.taskNodeId'], f.io),
  ).toBe(0)
  expect(JSON.parse(f.out()).nodes).toEqual([{ id: 'terminal', taskNodeId: 'terminal-task' }])
  expect(requests.filter(r => r.id === 'agent.list')).toHaveLength(0)
})
