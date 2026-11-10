// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { run } from '../../../src/app/cli/core/run'
import { identityFixture, node, project, space } from './cliIdentity.helpers'

const rect = { x: 10, y: 20, width: 420, height: 300 }
const createdSpace = {
  id: 'created-space',
  name: 'Review',
  directoryPath: '/repo',
  parentSpaceId: null,
  rect,
}
function fixture(inside = true) {
  const f = identityFixture(inside)
  f.values['space.create'] = {
    projectId: project.id,
    spaceId: createdSpace.id,
    space: createdSpace,
  }
  f.values['space.createChild'] = {
    projectId: project.id,
    childSpace: { ...createdSpace, parentSpaceId: space.id },
    movedNodeIds: [node.id],
  }
  return f
}

it.each([space.id, null])(
  'creates a top-level Space from the current node project (%s)',
  async spaceId => {
    const f = fixture()
    f.values['node.get'] = { node: { ...node, projectId: 'current-project', spaceId } }
    f.values['space.create'] = { projectId: 'current-project', space: createdSpace }
    expect(await run(['space', 'create', '--name', 'Review'], f.io)).toBe(0)
    expect(f.requests.find(r => r.id === 'space.create')?.payload).toEqual({
      projectId: 'current-project',
      name: 'Review',
    })
    expect(JSON.parse(f.out())).toEqual({
      ...createdSpace,
      projectId: 'current-project',
      movedNodeIds: [],
    })
  },
)

it('uses grant identity when the caller node environment is absent', async () => {
  const f = fixture()
  delete f.io.env.OPENCOVE_NODE_ID
  expect(await run(['space', 'create', '--name', 'Review'], f.io)).toBe(0)
  expect(f.requests.map(r => r.id)).toEqual(['system.whoami', 'node.get', 'space.create'])
})

it('supports a session grant without environment identity', async () => {
  const f = fixture(false)
  f.values['system.whoami'] = { kind: 'session-grant', scopeTier: 'interact', nodeId: node.id }
  expect(await run(['space', 'create', '--name', 'Review'], f.io)).toBe(0)
  expect(f.requests.find(r => r.id === 'space.create')?.payload.projectId).toBe(project.id)
})

it('requires --project for a caller without a terminal identity', async () => {
  const f = fixture(false)
  expect(await run(['space', 'create', '--name', 'Review'], f.io)).toBe(2)
  expect(f.error().message).toContain('--project')
  expect(f.requests.some(r => r.id === 'space.create')).toBe(false)
})

it.each([undefined, ''])(
  'requires --project for a bearer with a terminal marker but node ID %j',
  async nodeId => {
    const f = fixture(false)
    f.io.env.OPENCOVE_ENV = '1'
    f.io.env.OPENCOVE_NODE_ID = nodeId
    expect(await run(['space', 'create', '--name', 'Review'], f.io)).toBe(2)
    expect(f.error()).toMatchObject({
      code: 'cli.usage',
      message:
        'Creating a top-level space requires --project <selector> outside an OpenCove terminal',
    })
    expect(f.requests.map(r => r.id)).toEqual(['system.whoami'])
    expect(f.out()).toBe('')
  },
)

it.each([{}, { OPENCOVE_PROJECT_ID: 'stale-project' }, { OPENCOVE_ENV: '1' }])(
  'requires --project before offline profile discovery without identity: %j',
  async env => {
    const f = fixture(false)
    f.io.env = env
    f.io.profileCandidates = vi.fn(() => ['/isolated/missing-profile'])
    expect(await run(['space', 'create', '--name', 'Review'], f.io)).toBe(2)
    expect(f.error()).toMatchObject({
      code: 'cli.usage',
      message: expect.stringContaining('--project'),
    })
    expect(f.out()).toBe('')
    expect(f.io.profileCandidates).not.toHaveBeenCalled()
    expect(f.io.readTextFile).not.toHaveBeenCalled()
    expect(f.fetch).not.toHaveBeenCalled()
  },
)

it('resolves a token-only grant with an explicit token and no project identity', async () => {
  const f = fixture(false)
  delete f.io.env.OPENCOVE_CONTROL_TOKEN
  f.values['system.whoami'] = { kind: 'session-grant', scopeTier: 'interact', nodeId: node.id }
  expect(await run(['space', 'create', '--name', 'Review', '--token', 'session-token'], f.io)).toBe(
    0,
  )
  expect(f.requests.map(r => r.id)).toEqual(['system.whoami', 'node.get', 'space.create'])
})

it('gives --in guidance for a root-canvas terminal without a parent Space', async () => {
  const f = fixture()
  delete f.io.env.OPENCOVE_SPACE_ID
  f.values['system.whoami'] = {
    kind: 'session-grant',
    scopeTier: 'interact',
    nodeId: node.id,
    projectId: project.id,
    spaceId: null,
  }
  expect(await run(['space', 'create', '--name', 'Review', '--in', '@self'], f.io)).toBe(2)
  expect(f.error().message).toBe('This OpenCove terminal does not belong to a space.')
  expect(f.error().hint).toContain('--in <space selector>')
  expect(f.error().hint).toContain('omit --in')
  expect(f.error().hint).not.toContain('--space')
  expect(f.out()).toBe('')
  expect(f.requests.some(r => r.id === 'space.createChild')).toBe(false)
})

it('does not accept a mismatched caller node as a default project', async () => {
  const f = fixture()
  f.values['node.get'] = { node: { ...node, id: 'wrong' } }
  expect(await run(['space', 'create', '--name', 'Review'], f.io)).toBe(1)
  expect(f.error().code).toBe('node.not_found')
  expect(f.requests.some(r => r.id === 'space.create')).toBe(false)
})

it('resolves an explicit project and passes the directory unchanged', async () => {
  const f = fixture(false)
  expect(
    await run(
      ['space', 'create', '--name', 'Review', '--project', 'Project', '--directory', '/repo/sub'],
      f.io,
    ),
  ).toBe(0)
  expect(f.requests.find(r => r.id === 'space.create')?.payload).toEqual({
    projectId: project.id,
    name: 'Review',
    directoryPath: '/repo/sub',
  })
  expect(f.requests.some(r => r.id === 'node.get')).toBe(false)
})

it.each(['Main', 'space-', '@self', space.id])(
  'resolves parent selector %s and repeatable moved nodes',
  async parent => {
    const f = fixture()
    expect(
      await run(
        [
          'space',
          'create',
          '--name',
          'Review',
          '--in',
          parent,
          '--move',
          'Shell',
          '--move',
          node.id,
        ],
        f.io,
      ),
    ).toBe(0)
    expect(f.requests.find(r => r.id === 'space.createChild')?.payload).toEqual({
      parentSpaceId: space.id,
      name: 'Review',
      initialNodeIds: [node.id],
    })
    expect(JSON.parse(f.out())).toEqual({
      ...createdSpace,
      projectId: project.id,
      parentSpaceId: space.id,
      movedNodeIds: [node.id],
    })
  },
)

it('leaves child placement to the server and declares projectable fields', async () => {
  const f = fixture()
  expect(
    await run(
      ['space', 'create', '--name', 'Review', '--in', 'Main', '--fields', 'id,rect.x,movedNodeIds'],
      f.io,
    ),
  ).toBe(0)
  expect(JSON.parse(f.out())).toEqual({
    id: createdSpace.id,
    rect: { x: rect.x },
    movedNodeIds: [node.id],
  })
  expect(f.requests.find(r => r.id === 'space.createChild')?.payload).not.toHaveProperty('rect')
})

it('reports the applied child frame when the server adjusts it', async () => {
  const f = fixture()
  const stderr: string[] = []
  f.io.stderr.write = s => {
    stderr.push(s)
  }
  const frame = { ...rect, width: 900 }
  expect(
    await run(
      ['space', 'create', '--name', 'Review', '--in', 'Main', '--frame', JSON.stringify(frame)],
      f.io,
    ),
  ).toBe(0)
  expect(f.requests.find(r => r.id === 'space.createChild')?.payload.rect).toEqual(frame)
  expect(JSON.parse(f.out()).rect).toEqual(rect)
  expect(stderr.join('')).toContain('Notice: space frame adjusted; applied rect:')
})

it('rejects a node outside the selected parent before writing', async () => {
  const f = fixture()
  f.values['node.get'] = { node: { ...node, spaceId: 'another-space' } }
  expect(
    await run(['space', 'create', '--name', 'Review', '--in', 'Main', '--move', node.id], f.io),
  ).toBe(1)
  expect(f.error().code).toBe('node.not_found')
  expect(f.error().hint).toContain('--move')
  expect(f.error().hint).toContain('--in')
  expect(f.error().hint).not.toContain('Drop --space')
  expect(f.error().hint).not.toContain('across spaces')
  expect(f.requests.some(r => r.id === 'space.createChild')).toBe(false)
})

it.each([
  ['--move', 'Shell'],
  ['--frame', '{}'],
  ['--in', 'Main', '--directory', '/repo'],
  ['--in', 'Main', '--frame', '[]'],
  ['--in', 'Main', '--frame', '{"x":1}'],
  ['--in', 'Main', '--frame', '{"x":1,"y":2,"width":0,"height":3}'],
  ['--fields', 'invalid'],
  ['-o', 'table'],
])('rejects invalid options before connecting: %j', async (...extra) => {
  const f = fixture()
  expect(await run(['space', 'create', '--name', 'Review', ...extra], f.io)).toBe(2)
  expect(f.fetch).not.toHaveBeenCalled()
})

it.each([[], ['--name', '  ']])('requires a nonblank name: %j', async (...args) => {
  const f = fixture()
  expect(await run(['space', 'create', ...args], f.io)).toBe(2)
  expect(f.fetch).not.toHaveBeenCalled()
})

it('explains a server-side membership race without retrying creation', async () => {
  const f = fixture()
  const fetch = f.fetch.getMockImplementation()!
  f.fetch.mockImplementation(async (url, init) => {
    if (JSON.parse(String(init?.body)).id === 'space.createChild') {
      return new Response(
        JSON.stringify({
          ok: false,
          error: {
            code: 'common.invalid_input',
            debugMessage: 'space.createChild failed: nodes_not_in_parent',
          },
        }),
      )
    }
    return fetch(url, init)
  })
  expect(
    await run(['space', 'create', '--name', 'Review', '--in', 'Main', '--move', node.id], f.io),
  ).toBe(2)
  expect(f.error().message).toBe(
    'Every node selected with --move must belong directly to the parent space selected with --in.',
  )
  expect(f.out()).toBe('')
  expect(
    f.fetch.mock.calls.filter(
      ([, init]) => JSON.parse(String(init?.body)).id === 'space.createChild',
    ),
  ).toHaveLength(1)
})

it('preserves persistence errors without retrying or printing success', async () => {
  const f = fixture()
  const fetch = f.fetch.getMockImplementation()!
  f.fetch.mockImplementation(async (url, init) => {
    if (JSON.parse(String(init?.body)).id === 'space.createChild') {
      return new Response(
        JSON.stringify({
          ok: false,
          error: { code: 'persistence.io_failed', debugMessage: 'Unable to save the space' },
        }),
      )
    }
    return fetch(url, init)
  })
  expect(await run(['space', 'create', '--name', 'Review', '--in', '@self'], f.io)).toBe(1)
  expect(f.fetch.mock.calls.map(([, init]) => JSON.parse(String(init?.body)).id)).toEqual([
    'space.get',
    'space.createChild',
  ])
  expect(f.error()).toMatchObject({
    code: 'persistence.io_failed',
    message: 'Unable to save the space',
  })
  expect(f.out()).toBe('')
  expect(
    f.fetch.mock.calls.filter(
      ([, init]) => JSON.parse(String(init?.body)).id === 'space.createChild',
    ),
  ).toHaveLength(1)
})

it('scopes moved node names to an explicitly selected parent in another project', async () => {
  const f = fixture()
  f.values['space.get'] = { projectId: 'other-project', space: { ...space, id: 'foreign-space' } }
  f.values['node.list'] = { nodes: [{ ...node, spaceId: 'foreign-space' }] }
  f.values['node.get'] = { node: { ...node, projectId: 'other-project', spaceId: 'foreign-space' } }
  expect(
    await run(
      ['space', 'create', '--name', 'Review', '--in', 'foreign-space', '--move', 'Shell'],
      f.io,
    ),
  ).toBe(0)
  expect(f.requests.find(r => r.id === 'node.list')?.payload).toEqual({
    projectId: 'other-project',
    space: { kind: 'spaceId', spaceId: 'foreign-space' },
  })
  expect(f.requests.find(r => r.id === 'space.createChild')?.payload).toMatchObject({
    parentSpaceId: 'foreign-space',
    initialNodeIds: [node.id],
  })
})

it('requires an unambiguous parent before any write', async () => {
  const f = fixture()
  f.values['space.list'] = { spaces: [space, { ...space, id: 'second-space' }] }
  expect(await run(['space', 'create', '--name', 'Review', '--in', 'Main'], f.io)).toBe(6)
  expect(f.error().code).toBe('cli.ambiguous')
  expect(f.requests.some(r => r.id === 'space.createChild')).toBe(false)
})

it('prevents duplicate creation when an older Worker omits result details', async () => {
  const f = fixture()
  f.values['space.create'] = { projectId: project.id, spaceId: 'created', mountId: 'mount' }
  expect(await run(['space', 'create', '--name', 'Review'], f.io)).toBe(1)
  expect(f.error().hint).toContain('Do not repeat the creation command')
  expect(f.out()).toBe('')
  expect(f.requests.filter(r => r.id === 'space.create')).toHaveLength(1)
})
