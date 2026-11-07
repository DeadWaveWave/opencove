// @vitest-environment node
import { expect, it } from 'vitest'
import { run } from '../../../src/app/cli/core/run'
import { identityFixture, node, project, space } from './cliIdentity.helpers'

function scopedFixture() {
  const f = identityFixture()
  const notes = [
    {
      ...node,
      id: 'abcdef-note-1',
      kind: 'note',
      title: 'Notes',
      data: { kind: 'note', text: 'First\n  note ' + 'x'.repeat(65) },
    },
    {
      ...node,
      id: 'abcdef-note-2',
      kind: 'note',
      title: 'Notes',
      spaceId: 'space-other',
      data: { kind: 'note', text: 'Second note' },
    },
  ]
  f.values['space.list'] = {
    projectId: project.id,
    spaces: [space, { ...space, id: 'space-other', name: 'Side' }],
  }
  const fetch = f.io.fetch
  f.io.fetch = async (url, init) => {
    const request = JSON.parse(String(init?.body))
    if (request.id === 'node.list' || request.id === 'node.get') {
      f.requests.push(request)
      if (request.id === 'node.list') {
        const spaceId = request.payload.space?.spaceId
        return new Response(
          JSON.stringify({
            ok: true,
            value: {
              projectId: project.id,
              nodes: notes.filter(n => !spaceId || n.spaceId === spaceId),
            },
          }),
        )
      }
      const found = notes.find(n => n.id === request.payload.nodeId)
      return new Response(
        JSON.stringify(
          found
            ? { ok: true, value: { node: found } }
            : { ok: false, error: { code: 'node.not_found' } },
        ),
      )
    }
    return fetch(url, init)
  }
  return { ...f, notes }
}

it('enriches ambiguity with space names and single-line note previews capped at 60 characters', async () => {
  const f = scopedFixture()
  expect(await run(['node', 'delete', '--node', 'Notes'], f.io)).toBe(6)
  const candidates = f.error().details.candidates
  expect(candidates).toHaveLength(2)
  expect(candidates[0]).toMatchObject({
    spaceId: space.id,
    spaceName: 'Main',
    preview: 'First note ' + 'x'.repeat(48) + '…',
  })
  expect(candidates[0].preview).toHaveLength(60)
  expect(candidates[1]).toMatchObject({
    spaceId: 'space-other',
    spaceName: 'Side',
    preview: 'Second note',
  })
  expect(f.requests.some(r => r.id === 'node.delete')).toBe(false)
})

it.each([
  ['node', 'get'],
  ['node', 'delete'],
  ['node', 'update', 'note'],
  ['canvas', 'focus', 'node'],
  ['agent', 'get'],
])('scopes --node names for %j', async (...path) => {
  const f = scopedFixture()
  expect(await run([...path, '--node', 'Notes', '--space', 'Main'], f.io)).toBe(
    path[0] === 'agent' ? 1 : 0,
  )
  if (path[0] === 'agent') {
    expect(f.error().code).toBe('agent.not_found')
  }
  expect(f.requests.find(r => r.id === 'node.list')?.payload.space).toEqual({
    kind: 'spaceId',
    spaceId: space.id,
  })
  expect(f.requests.some(r => r.id === 'node.get' && r.payload.nodeId === f.notes[1].id)).toBe(
    false,
  )
})

it('scopes prefixes and exact IDs to an explicit space', async () => {
  const f = scopedFixture()
  expect(await run(['node', 'get', '--node', 'abcdef', '--space', 'Main'], f.io)).toBe(0)
  expect(JSON.parse(f.out()).node.id).toBe(f.notes[0].id)
  const g = scopedFixture()
  expect(await run(['node', 'get', '--node', g.notes[1].id, '--space', 'Main'], g.io)).toBe(1)
  expect(g.error()).toMatchObject({
    code: 'node.not_found',
    hint: expect.stringContaining('Drop --space'),
  })
  expect(g.out()).toBe('')
})

it.each([
  ['node', 'get', '--node', space.id, 'space'],
  ['space', 'get', '--space', node.id, 'node'],
  ['mount', 'list', '--project', node.id, 'node'],
  ['node', 'delete', '--node', project.id, 'project'],
])('identifies wrong-kind IDs: %s %s %s %s', async (...args) => {
  const kind = args.pop()
  const f = identityFixture()
  expect(await run(args, f.io)).toBe(1)
  expect(f.error().message).toContain(`known ${kind} ID`)
  expect(f.requests.some(r => r.id === 'node.delete')).toBe(false)
})

it('reports project and space scope and suggests at most three close names, without choosing any', async () => {
  const f = scopedFixture()
  expect(await run(['node', 'delete', '--node', 'notes', '--space', 'Main'], f.io)).toBe(1)
  expect(f.error().message).toContain(`project "${project.id}", space "${space.id}"`)
  expect(f.error().hint).toContain('Suggested name: "Notes"')
  expect(f.requests.some(r => r.id === 'node.delete')).toBe(false)
  const g = identityFixture()
  g.values['node.list'] = {
    nodes: ['Cat', 'Bat', 'Hat', 'Mat', 'Far away'].map((title, i) => ({
      ...node,
      id: `n${i}`,
      title,
    })),
  }
  expect(await run(['node', 'delete', '--node', 'cat'], g.io)).toBe(1)
  expect(g.error().hint.match(/Suggested name/g)).toHaveLength(3)
  expect(g.error().hint).not.toContain('Far away')
})

it('uses a selected space owner for names outside the session project', async () => {
  const f = scopedFixture()
  f.values['space.get'] = { projectId: 'other-project', space }
  expect(await run(['node', 'get', '--node', 'Notes', '--space', space.id], f.io)).toBe(0)
  expect(f.requests.find(r => r.id === 'node.list')?.payload.projectId).toBe('other-project')
})
