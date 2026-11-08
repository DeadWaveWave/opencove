// @vitest-environment node
import { expect, it } from 'vitest'
import { run } from '../../../src/app/cli/core/run'
import { identityFixture, node, project, space } from './cliIdentity.helpers'

it('resolves node names within an explicit space without limiting lookup', async () => {
  const f = identityFixture()
  expect(await run(['node', 'get', '--node', 'Shell', '--space', 'Main'], f.io)).toBe(0)
  expect(f.requests.find(r => r.id === 'node.list')?.payload).toEqual({
    projectId: project.id,
    space: { kind: 'spaceId', spaceId: space.id },
  })
})

it('limits projected lists and preserves their envelope and total', async () => {
  const f = identityFixture(false)
  f.values['project.list'] = {
    activeProjectId: project.id,
    projects: [project, { ...project, id: 'p2' }],
  }
  expect(await run(['project', 'list', '--limit', '1', '--fields', 'id'], f.io)).toBe(0)
  expect(JSON.parse(f.out())).toEqual({
    activeProjectId: project.id,
    projects: [{ id: project.id }],
    truncated: { projects: 2 },
  })
})

it('keeps space membership and counts while omitting full nodes by default', async () => {
  const f = identityFixture(false)
  f.values['space.list'] = {
    projectId: project.id,
    spaces: [{ ...space, nodeIds: [node.id], nodes: [node] }],
  }
  expect(await run(['space', 'list'], f.io)).toBe(0)
  expect(JSON.parse(f.out()).spaces[0]).toEqual({
    ...space,
    nodes: undefined,
    nodeIds: [node.id],
    nodeCount: 1,
    projectId: project.id,
  })
})

it.each(['api schema', 'api call'])('suggests unknown operations for %s before IO', async path => {
  const f = identityFixture(false)
  expect(await run([...path.split(' '), 'node.gte'], f.io)).toBe(2)
  expect(f.error().hint).toContain('node.get')
  expect(f.error().hint).toContain('opencove api ops --prefix node')
  expect(f.fetch).not.toHaveBeenCalled()
})

it('gives actionable URI errors before IO', async () => {
  const f = identityFixture(false)
  expect(await run(['fs', 'read', '--uri', 'README.md'], f.io)).toBe(2)
  expect(f.error().message).toContain('absolute file:// URI')
  expect(f.error().hint).toContain('README.md')
  expect(f.error().hint).toContain('opencove mount list --project "@self" --fields mountId,rootUri')
  expect(f.fetch).not.toHaveBeenCalled()
})

it('suggests close names only and reports the search scope', async () => {
  const f = identityFixture()
  expect(await run(['node', 'delete', '--node', 'shell'], f.io)).toBe(1)
  expect(f.error().message).toContain(project.id)
  expect(f.error().hint).toContain('Shell')
  expect(f.requests.some(r => r.id === 'node.delete')).toBe(false)
})

it('renames context directory and catalog fields', async () => {
  const f = identityFixture()
  expect(await run(['context', '--fields', 'space.directoryPath'], f.io)).toBe(0)
  expect(JSON.parse(f.out()).space).toEqual({ directoryPath: '/repo' })
  const g = identityFixture(false)
  expect(await run(['api', 'ops', '--domains', '--fields', 'domain,commandOperations'], g.io)).toBe(
    0,
  )
  expect(JSON.parse(g.out())).toContainEqual({ domain: 'node', commandOperations: 3 })
})

it.each(['read', 'interact', 'admin'])(
  'catalog uses whoami scope %s inside a session',
  async scopeTier => {
    const f = identityFixture()
    f.values['system.whoami'] = { kind: 'session-grant', scopeTier }
    expect(await run(['api', 'ops'], f.io)).toBe(0)
    const catalog = JSON.parse(f.out())
    expect(catalog.find((op: { id: string }) => op.id === 'node.get')).toMatchObject({
      scope: 'read',
      allowed: true,
      cliCommand: 'opencove node get',
    })
    expect(catalog.find((op: { id: string }) => op.id === 'node.delete').allowed).toBe(
      scopeTier !== 'read',
    )
    expect(catalog.find((op: { id: string }) => op.id === 'mount.create').allowed).toBe(
      scopeTier === 'admin',
    )
  },
)

it.each([
  ['fs', 'write', '--uri', 'notes.txt', '--content', 'hello'],
  ['fs', 'stat', '--uri', '/tmp/path with spaces.txt'],
  ['fs', 'ls', '--uri', 'file:relative'],
  ['fs', 'read', '--uri', 'https://example.com/file'],
  ['fs', 'read', '--mount', 'm', '--uri', 'README.md'],
  ['pty', 'spawn-in-mount', '--mount', 'm', '--cwd-uri', 'repo'],
  [
    'api',
    'call',
    'filesystem.moveEntry',
    '--input',
    '{"sourceUri":"file:///repo/a","targetUri":"b"}',
  ],
])('validates URI-typed inputs across dedicated and generic routes: %j', async (...args) => {
  const f = identityFixture(false)
  expect(await run(args, f.io)).toBe(2)
  expect(f.error().message).toContain('absolute file:// URI')
  expect(f.fetch).not.toHaveBeenCalled()
})

it.each([
  ['C:\\repo\\a b.txt', 'file:///C:/repo/a%20b.txt'],
  ['\\\\server\\share\\notes.txt', 'file://server/share/notes.txt'],
  ['/repo/a#b.txt', 'file:///repo/a%23b.txt'],
])('builds portable file URI examples: %s', async (input, example) => {
  const f = identityFixture(false)
  expect(await run(['fs', 'read', '--uri', input], f.io)).toBe(2)
  expect(f.error().hint).toContain(example)
})

it('keeps the catalog offline outside a session, including explicit allowed projection', async () => {
  const f = identityFixture(false)
  expect(await run(['api', 'ops', '--prefix', 'node', '--fields', 'id,scope,allowed'], f.io)).toBe(
    0,
  )
  expect(
    JSON.parse(f.out()).every(
      (op: Record<string, unknown>) => op.scope && !Object.hasOwn(op, 'allowed'),
    ),
  ).toBe(true)
  expect(f.fetch).not.toHaveBeenCalled()
})

it('requires authenticated scope inside a session and never guesses from identity environment variables', async () => {
  const f = identityFixture()
  f.io.fetch = async () => new Response('{}', { status: 403 })
  expect(await run(['api', 'ops'], f.io)).toBe(4)
  expect(f.out()).toBe('')
})

it('suggests same-domain operation IDs when edit distance is large', async () => {
  const f = identityFixture(false)
  expect(await run(['api', 'schema', 'node.missing'], f.io)).toBe(2)
  expect(f.error().hint).toContain('node.')
  expect(f.error().hint).toContain('opencove api ops --prefix node')
})
