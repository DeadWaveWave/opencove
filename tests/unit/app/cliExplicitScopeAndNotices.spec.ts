// @vitest-environment node
import { expect, it } from 'vitest'
import { run } from '../../../src/app/cli/core/run'
import { identityFixture, node, project, space } from './cliIdentity.helpers'

function targets(id: string, targetSpace: string | null = 'space-other') {
  const f = identityFixture()
  const target = { ...node, id, title: 'Outside', spaceId: targetSpace }
  const original = f.io.fetch
  f.io.fetch = async (url, init) => {
    const request = JSON.parse(String(init?.body))
    if (request.id === 'node.get' || request.id === 'node.list') {
      f.requests.push(request)
      if (request.id === 'node.list') {
        return new Response(
          JSON.stringify({
            ok: true,
            value: {
              projectId: project.id,
              nodes:
                request.payload.space?.spaceId && target.spaceId !== request.payload.space.spaceId
                  ? []
                  : [target],
            },
          }),
        )
      }
      return new Response(
        JSON.stringify(
          request.payload.nodeId === id
            ? { ok: true, value: { node: target } }
            : { ok: false, error: { code: 'node.not_found' } },
        ),
      )
    }
    return original(url, init)
  }
  return f
}

it.each(['00000000-0000-4000-8000-000000000001', 'legacy-outside'])(
  'rejects exact ID %s outside an explicitly chosen space before mutation',
  async id => {
    const f = targets(id)
    expect(await run(['node', 'delete', '--node', id, '--space', 'Main'], f.io)).toBe(1)
    expect(f.error()).toMatchObject({
      code: 'node.not_found',
      message: expect.stringContaining('space-other'),
      hint: expect.stringContaining('Drop --space'),
    })
    expect(f.error().message).toContain(space.id)
    expect(f.out()).toBe('')
    expect(f.requests.some(r => r.id === 'node.delete')).toBe(false)
  },
)

it.each(['Outside', 'legacy-', '@self'])(
  'constrains node selector %s to an explicit space',
  async selector => {
    const f = targets(selector === '@self' ? node.id : 'legacy-outside')
    expect(await run(['node', 'delete', '--node', selector, '--space', '@self'], f.io)).toBe(1)
    expect(f.error().code).toBe('node.not_found')
    expect(f.requests.some(r => r.id === 'node.delete')).toBe(false)
  },
)

it.each(['00000000-0000-4000-8000-000000000001', 'legacy-outside'])(
  'retains unscoped full-ID reads and accepts matching explicit space for %s',
  async id => {
    const f = targets(id)
    expect(await run(['node', 'get', '--node', id], f.io)).toBe(0)
    expect(JSON.parse(f.out()).node.spaceId).toBe('space-other')
    const g = targets(id, space.id)
    expect(await run(['node', 'get', '--node', id, '--space', '@self'], g.io)).toBe(0)
  },
)

it('rejects an ungrouped exact node with explicit space', async () => {
  const f = targets('ungrouped', null)
  expect(await run(['node', 'delete', '--node', 'ungrouped', '--space', 'Main'], f.io)).toBe(1)
  expect(f.error().message).toContain(space.id)
  expect(f.error().hint).toContain('Drop --space')
})

it.each(['project', 'node'])(
  'notices limited %s tables on stderr while keeping stdout a table',
  async kind => {
    const f = identityFixture(false)
    const notices: string[] = []
    f.io.stderr.write = text => notices.push(text)
    f.values[`${kind}.list`] = {
      [`${kind}s`]:
        kind === 'node'
          ? [node, { ...node, id: 'second' }]
          : [project, { ...project, id: 'second' }],
    }
    expect(await run([kind, 'list', '-o', 'table', '--limit', '1', '--fields', 'id'], f.io)).toBe(0)
    expect(notices).toEqual([
      kind === 'node'
        ? 'Showing 1 of 2 nodes; 1 omitted. Use --full or --limit 0 for all, or --limit <n> to choose a limit.\n'
        : `Showing 1 of 2 ${kind}s; use --limit 0 for all.\n`,
    ])
    expect(f.out().trim().split('\n')).toHaveLength(2)
    expect(f.out()).not.toContain('Showing')
  },
)

it.each(['0', '2', '5'])('keeps uncut tables silent with limit %s', async limit => {
  const f = identityFixture(false)
  const notices: string[] = []
  f.io.stderr.write = text => notices.push(text)
  f.values['project.list'] = { projects: [project, project] }
  expect(await run(['project', 'list', '-o', 'table', '--limit', limit], f.io)).toBe(0)
  expect(notices).toEqual([])
  expect(f.out().trim().split('\n')).toHaveLength(3)
})

it.each(['terminal', 'note', 'agent'])(
  'refuses agent get for %s without run state, including field projection',
  async kind => {
    const f = identityFixture()
    f.values['node.get'] = { node: { ...node, kind } }
    f.values['agent.get'] = null
    expect(await run(['agent', 'get', '--node', '@self', '--fields', 'state'], f.io)).toBe(1)
    expect(f.error().code).toBe('agent.not_found')
    expect(f.error().message).toContain('Shell')
    expect(f.error().message).toContain(
      kind === 'agent' ? 'no registered agent run state' : `${kind}, not an agent window`,
    )
    expect(f.out()).toBe('')
  },
)

it('keeps agent list unaffected for an empty run registry', async () => {
  const f = identityFixture()
  f.values['agent.list'] = { epoch: 'e', seq: 1, agents: [] }
  expect(await run(['agent', 'list'], f.io)).toBe(0)
  expect(JSON.parse(f.out())).toEqual({ epoch: 'e', seq: 1, agents: [] })
})

it('enforces membership even if a list response includes a node outside the requested space', async () => {
  const f = identityFixture()
  f.values['node.get'] = { node: { ...node, spaceId: 'outside' } }
  expect(await run(['node', 'delete', '--node', 'Shell', '--space', 'Main'], f.io)).toBe(1)
  expect(f.error()).toMatchObject({
    code: 'node.not_found',
    hint: expect.stringContaining('Drop --space'),
  })
  expect(f.requests.some(r => r.id === 'node.delete')).toBe(false)
})

it('refuses repeated node selectors before starting agent wait if any is outside explicit space', async () => {
  const f = targets(node.id)
  expect(
    await run(
      ['agent', 'wait', '--node', '@self', '--node', node.id, '--space', 'Main', '--until', 'idle'],
      f.io,
    ),
  ).toBe(1)
  expect(f.error().code).toBe('node.not_found')
  expect(f.requests.some(r => r.id === 'agent.get' || r.id === 'agent.list')).toBe(false)
})

it('notices a cut catalog table once and keeps JSON object truncation metadata', async () => {
  const f = identityFixture(false)
  const notices: string[] = []
  f.io.stderr.write = text => notices.push(text)
  expect(await run(['api', 'ops', '--prefix', 'node', '-o', 'table', '--limit', '1'], f.io)).toBe(0)
  expect(notices).toEqual(['Showing 1 of 6 operations; use --limit 0 for all.\n'])
  const g = identityFixture(false)
  const jsonNotices: string[] = []
  g.io.stderr.write = text => jsonNotices.push(text)
  g.values['project.list'] = { projects: [project, project] }
  expect(await run(['project', 'list', '--limit', '1'], g.io)).toBe(0)
  expect(JSON.parse(g.out()).truncated).toEqual({ projects: 2 })
  expect(jsonNotices).toEqual([])
})

it('keeps agent list title enrichment for non-agent metadata unaffected', async () => {
  const f = identityFixture()
  f.values['agent.list'] = { epoch: 'e', seq: 1, agents: [{ nodeId: node.id, state: 'idle' }] }
  expect(await run(['agent', 'list'], f.io)).toBe(0)
  expect(JSON.parse(f.out()).agents[0]).toMatchObject({ nodeId: node.id, title: node.title })
})

it('returns Worker run state despite terminal node metadata', async () => {
  const f = identityFixture()
  f.values['agent.get'] = { nodeId: node.id, state: 'idle' }
  expect(await run(['agent', 'get', '--node', '@self'], f.io)).toBe(0)
  expect(JSON.parse(f.out())).toMatchObject({ nodeId: node.id, state: 'idle', title: node.title })
})

it('retains a valid agent snapshot when its node is concurrently deleted', async () => {
  const f = identityFixture()
  f.values['agent.get'] = { nodeId: node.id, state: 'exited' }
  const original = f.io.fetch
  f.io.fetch = async (url, init) =>
    JSON.parse(String(init?.body)).id === 'node.get'
      ? new Response(JSON.stringify({ ok: false, error: { code: 'node.not_found' } }))
      : original(url, init)
  expect(await run(['agent', 'get', '--node', '@self'], f.io)).toBe(0)
  expect(JSON.parse(f.out())).toEqual({
    nodeId: node.id,
    state: 'exited',
    lastEndedTurn: null,
    title: null,
    taskNodeId: null,
  })
})
