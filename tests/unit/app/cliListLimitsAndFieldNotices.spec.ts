// @vitest-environment node
import { expect, it } from 'vitest'
import { run } from '../../../src/app/cli/core/run'
import { render } from '../../../src/app/cli/core/render'
import { commands } from '../../../src/app/cli/commands'
import { identityFixture, node, project, space } from './cliIdentity.helpers'

it.each(['-1', '1.5', 'NaN', 'Infinity', '9007199254740992'])(
  'rejects invalid --limit %s before IO',
  async limit => {
    const f = identityFixture(false)
    expect(await run(['project', 'list', '--limit', limit], f.io)).toBe(2)
    expect(f.fetch).not.toHaveBeenCalled()
  },
)

it.each([0, 1, 2, 3])(
  'preserves filtered list envelopes and records totals only when cut: %s',
  async limit => {
    const f = identityFixture(false)
    f.values['node.list'] = {
      projectId: project.id,
      spaceId: space.id,
      nodes: [node, { ...node, id: 'n2' }],
    }
    expect(await run(['node', 'list', '--limit', String(limit), '--fields', 'id'], f.io)).toBe(0)
    expect(JSON.parse(f.out())).toEqual({
      projectId: project.id,
      spaceId: space.id,
      nodes: [{ id: node.id }, { id: 'n2' }].slice(0, limit || undefined),
      ...(limit > 0 && limit < 2 ? { truncated: true, total: 2 } : {}),
    })
  },
)

it('limits bare-array catalogs only when cut, after filters and projection', async () => {
  const f = identityFixture(false)
  const notices: string[] = []
  f.io.stderr.write = text => notices.push(text)
  expect(
    await run(['api', 'ops', '--prefix', 'node', '--fields', 'id', '--limit', '1'], f.io),
  ).toBe(0)
  const value = JSON.parse(f.out())
  expect(Array.isArray(value)).toBe(true)
  expect(value).toHaveLength(1)
  expect(Object.keys(value[0])).toEqual(['id'])
  expect(notices).toEqual(['Showing 1 of 6 operations; use --limit 0 for all.\n'])
  expect(f.fetch).not.toHaveBeenCalled()
  const g = identityFixture(false)
  expect(await run(['api', 'ops', '--prefix', 'absent', '--limit', '0'], g.io)).toBe(0)
  expect(JSON.parse(g.out())).toEqual([])
})

it('limits all named top-level lists, including generic API output', async () => {
  const f = identityFixture(false)
  f.values['project.list'] = { projects: [project, project], other: [1, 2, 3] }
  expect(await run(['api', 'call', 'project.list', '--limit', '1'], f.io)).toBe(0)
  expect(JSON.parse(f.out()).truncated).toEqual({ projects: 2, other: 3 })
})

it.each(['nodes', 'spaces.nodes.id'])(
  'lets --fields opt into full space nodes: %s',
  async fields => {
    const f = identityFixture(false)
    f.values['space.list'] = { spaces: [{ ...space, nodeIds: [node.id], nodes: [node] }] }
    expect(await run(['space', 'list', '--fields', fields], f.io)).toBe(0)
    expect(JSON.parse(f.out()).spaces[0].nodes).toEqual(
      fields === 'nodes' ? [node] : [{ id: node.id }],
    )
  },
)

it('writes one notice for fields absent on a node kind while keeping projected stdout', async () => {
  const f = identityFixture(false)
  f.values['node.get'] = { node: { ...node, kind: 'note', data: { kind: 'note', text: '' } } }
  let stderr = ''
  f.io.stderr.write = text => {
    stderr += text
  }
  expect(
    await run(['node', 'get', '--node', node.id, '--fields', 'data.requirement,data.url'], f.io),
  ).toBe(0)
  expect(JSON.parse(f.out())).toEqual({ node: {} })
  expect(stderr.trim().split('\n')).toHaveLength(1)
  expect(stderr).toContain('data.requirement (note)')
  expect(stderr).toContain('data.url (note)')
  expect(stderr).toContain('data.text')
})

it('does not warn for empty note content or empty lists', async () => {
  const f = identityFixture(false)
  f.values['node.get'] = { node: { ...node, kind: 'note', data: { kind: 'note', text: '' } } }
  const writes: string[] = []
  f.io.stderr.write = text => writes.push(text)
  expect(await run(['node', 'get', '--node', node.id, '--fields', 'node.data.text'], f.io)).toBe(0)
  expect(JSON.parse(f.out()).node.data.text).toBe('')
  expect(writes).toEqual([])
})

it('uses uppercase table headers for every declared table, including explicit fields', () => {
  for (const command of commands.filter(c => c.render?.columns)) {
    const spec = command.render!
    const item = Object.fromEntries(spec.columns!.map(column => [column, 'value']))
    const value = spec.listKey ? { [spec.listKey]: [item] } : spec.list ? [item] : item
    const header = render(value, { output: 'table' }, spec).split('\n')[0]
    expect(header).toBe(header.toUpperCase())
  }
  expect(
    render(
      { projects: [{ id: 'p', name: 'P' }] },
      { output: 'table', fields: 'id,name', limit: 0 },
      { listKey: 'projects', fields: ['id', 'name'], columns: ['id', 'name'] },
    ),
  ).toBe('ID  NAME\np   P\n')
})

it.each(['get', 'list'])('node %s help explains content per kind', async action => {
  const f = identityFixture(false)
  expect(await run(['node', action, '--help'], f.io)).toBe(0)
  for (const text of [
    'data.text',
    'data.requirement',
    'data.status',
    'data.priority',
    'data.tags',
    'data.url',
    'status, sessionId',
  ]) {
    expect(f.out()).toContain(text)
  }
})

it('does not mistake context envelope fields for node-relative fields', async () => {
  const f = identityFixture()
  f.values['node.list'] = {
    nodes: [{ ...node, id: 'neighbor', kind: 'task', data: { status: 'todo' } }],
  }
  const writes: string[] = []
  f.io.stderr.write = text => writes.push(text)
  expect(await run(['context', '--fields', 'space.name'], f.io)).toBe(0)
  expect(JSON.parse(f.out())).toEqual({ space: { name: space.name } })
  expect(writes).toEqual([])
})

it('notices missing fields on mixed node lists but ignores empty lists', async () => {
  for (const nodes of [
    [],
    [node, { ...node, id: 'task', kind: 'task', data: { status: 'todo' } }],
  ]) {
    const f = identityFixture(false)
    const writes: string[] = []
    f.io.stderr.write = text => writes.push(text)
    f.values['node.list'] = { nodes }
    // eslint-disable-next-line no-await-in-loop
    expect(await run(['node', 'list', '--fields', 'data.status'], f.io)).toBe(0)
    expect(writes).toHaveLength(nodes.length ? 1 : 0)
    if (nodes.length) {
      expect(writes[0]).toContain('data.status (terminal)')
    }
  }
})

it.each(['0', '6', '10'])('keeps complete bare arrays silent with --limit %s', async limit => {
  const f = identityFixture(false)
  const notices: string[] = []
  f.io.stderr.write = text => notices.push(text)
  expect(await run(['api', 'ops', '--prefix', 'node', '--limit', limit], f.io)).toBe(0)
  expect(JSON.parse(f.out())).toHaveLength(6)
  expect(notices).toEqual([])
})

it('keeps domain summaries and generic API arrays as arrays with one notice', async () => {
  const f = identityFixture(false)
  const notices: string[] = []
  f.io.stderr.write = text => notices.push(text)
  expect(await run(['api', 'ops', '--domains', '--limit', '1'], f.io)).toBe(0)
  expect(Array.isArray(JSON.parse(f.out()))).toBe(true)
  expect(notices).toHaveLength(1)
  expect(notices[0]).toMatch(/^Showing 1 of \d+ domains; use --limit 0 for all\.\n$/)
  const g = identityFixture(false)
  g.io.stderr.write = text => notices.push(text)
  g.values['system.homeDirectory'] = [1, 2, 3]
  expect(await run(['api', 'call', 'system.homeDirectory', '--limit', '2'], g.io)).toBe(0)
  expect(JSON.parse(g.out())).toEqual([1, 2])
  expect(notices[1]).toBe('Showing 2 of 3 items; use --limit 0 for all.\n')
})
