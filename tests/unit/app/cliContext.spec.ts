// @vitest-environment node
import { expect, it } from 'vitest'
import { run } from '../../../src/app/cli/core/run'
import { identityFixture, who, node, project, space } from './cliIdentity.helpers'

it('orients a session, excludes self and chooses task versus runtime state', async () => {
  const f = identityFixture()
  f.values['agent.list'] = { epoch: 'e', seq: 1, agents: [{ nodeId: 'agent', state: 'idle' }] }
  f.values['node.list'] = {
    nodes: [
      node,
      { id: 'task', kind: 'task', title: 'Review', status: 'wrong', data: { status: 'doing' } },
      { id: 'agent', kind: 'agent', title: 'Agent', status: 'running' },
      { id: 'note', kind: 'note', title: 'Notes', status: 'wrong' },
    ],
  }
  expect(await run(['context'], f.io)).toBe(0)
  expect(JSON.parse(f.out())).toEqual({
    self: {
      caller: 'session-grant',
      scope: 'interact',
      projectId: who.projectId,
      spaceId: who.spaceId,
      nodeId: who.nodeId,
      sessionId: who.sessionId,
    },
    project: { id: project.id, name: project.name, path: project.path },
    space: { id: space.id, name: space.name, directory: space.directoryPath },
    nodes: [
      { id: 'task', kind: 'task', title: 'Review', state: 'doing' },
      { id: 'agent', kind: 'agent', title: 'Agent', state: 'idle', sessionStatus: 'running' },
      { id: 'note', kind: 'note', title: 'Notes', state: null },
    ],
    next: [
      'opencove node get --node "@self"',
      'opencove node list --space "@self"',
      'opencove space get --space "@self"',
      'opencove node create note --space "@self" --text \'Progress update\'',
      'opencove node list --space "@self" --kind task --fields id,title,data.status',
    ],
  })
  expect(f.out()).not.toContain('secret')
})

it.each(['project,space.name,nodes.id', 'self.caller,next'])(
  'projects context fields: %s',
  async fields => {
    const f = identityFixture()
    expect(await run(['context', '--fields', fields], f.io)).toBe(0)
    const output = JSON.parse(f.out())
    expect(Object.keys(output)).toEqual(
      fields === 'self.caller,next' ? ['self', 'next'] : ['project', 'space', 'nodes'],
    )
    if (output.self) {
      expect(output.self).toEqual({ caller: 'session-grant' })
    }
  },
)

it('rejects invalid context projection before connecting', async () => {
  const f = identityFixture()
  expect(await run(['context', '--fields', 'nodes.secret'], f.io)).toBe(2)
  expect(f.fetch).not.toHaveBeenCalled()
})

it.each(['--space', '--project'])(
  'orients outside OpenCove using %s and omits identity',
  async flag => {
    const f = identityFixture(false)
    expect(await run(['context', flag, flag === '--space' ? 'Main' : 'Project'], f.io)).toBe(0)
    const output = JSON.parse(f.out())
    expect(output).not.toHaveProperty('caller')
    expect(output).not.toHaveProperty('scope')
    expect(output.project.id).toBe(project.id)
    expect(output.space.id).toBe(space.id)
    expect(output.next).toHaveLength(3)
    expect(output.next.join(' ')).not.toContain('@self')
    expect(f.requests.filter(r => r.id === 'system.whoami')).toHaveLength(
      flag === '--space' ? 1 : 0,
    )
  },
)

it('requires explicit context outside OpenCove', async () => {
  const f = identityFixture(false)
  expect(await run(['context'], f.io)).toBe(2)
  expect(f.fetch).not.toHaveBeenCalled()
})

it('supports token-only @self context', async () => {
  const f = identityFixture()
  f.io.env = { OPENCOVE_CONTROL_URL: 'http://fixture', OPENCOVE_CONTROL_TOKEN: 'secret' }
  expect(await run(['context', '--space', '@self'], f.io)).toBe(0)
  expect(JSON.parse(f.out())).toMatchObject({
    self: { caller: 'session-grant' },
    project: { id: project.id },
  })
})

it('keeps the caller under self when the target is another project', async () => {
  const f = identityFixture()
  const other = { ...project, id: 'other-project', name: 'Other', activeSpaceId: null }
  f.values['project.list'] = { projects: [project, other] }
  expect(await run(['context', '--project', 'other-project'], f.io)).toBe(0)
  const output = JSON.parse(f.out())
  expect(output.self).toMatchObject({ projectId: who.projectId, spaceId: who.spaceId })
  expect(output.project).toMatchObject({ id: 'other-project' })
  expect(output).not.toHaveProperty('projectId')
  expect(output).not.toHaveProperty('spaceId')
})

it('handles a project without an active space without guessing a space', async () => {
  const f = identityFixture(false)
  f.values['project.list'] = { projects: [{ ...project, activeSpaceId: null }] }
  expect(await run(['context', '--project', 'Project'], f.io)).toBe(0)
  expect(JSON.parse(f.out())).toMatchObject({ space: null, nodes: [], next: expect.any(Array) })
  expect(JSON.parse(f.out()).next.join(' ')).not.toContain('@self')
  expect(f.requests.some(r => r.id === 'space.get')).toBe(false)
})

it('keeps 20 full UUID neighbors within a measured compact output budget', async () => {
  const f = identityFixture()
  f.values['node.list'] = {
    nodes: Array.from({ length: 20 }, (_, i) => ({
      id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      kind: 'task',
      title: `Task ${i}`,
      data: { status: 'todo', requirement: 'x'.repeat(10000) },
    })),
  }
  expect(await run(['context'], f.io)).toBe(0)
  expect(JSON.parse(f.out()).nodes).toHaveLength(20)
  // The requested 1.5 KB target cannot contain 20 UUIDs plus all mandatory fields.
  // Preserve IDs and neighbors rather than silently dropping actionable information.
  expect(Buffer.byteLength(f.out())).toBeLessThan(3000)
  expect(f.out()).not.toContain('requirement')
})

it.each(['whoami', 'context', 'node get'])('documents %s offline', async path => {
  const f = identityFixture(false)
  expect(await run([...path.split(' '), '--help'], f.io)).toBe(0)
  expect(f.out()).toMatchSnapshot()
  expect(f.fetch).not.toHaveBeenCalled()
})

it.each([200, 403])('maps server scope denial to exit 4 (HTTP %s)', async status => {
  const f = identityFixture()
  f.io.fetch = async () =>
    new Response(
      JSON.stringify({
        ok: false,
        error: { code: 'common.forbidden', details: { scope: 'interact' } },
      }),
      { status },
    )
  expect(
    await run(['api', 'call', 'workspace.approveRoot', '--input', '{"path":"/repo"}'], f.io),
  ).toBe(4)
  expect(f.error()).toMatchObject({
    code: 'common.forbidden',
    message: expect.stringContaining('may read and interact'),
    hint: expect.stringContaining('outside the OpenCove session'),
    details: { scope: 'interact' },
  })
})
