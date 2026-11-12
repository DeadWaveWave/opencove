// @vitest-environment node
import { expect, it } from 'vitest'
import { run } from '../../../src/app/cli/core/run'
import { identityFixture, project, space } from './cliIdentity.helpers'

it('space shapes: get adds the same row metadata as list while preserving nodes and envelope', async () => {
  const f = identityFixture(false)
  f.values['space.get'] = { projectId: project.id, space: { ...space, nodeIds: ['n'] } }
  expect(
    await run(
      ['space', 'get', '--space', space.id, '--fields', 'id,projectId,nodeCount,nodeIds'],
      f.io,
    ),
  ).toBe(0)
  expect(JSON.parse(f.out()).space).toEqual({
    id: space.id,
    projectId: project.id,
    nodeCount: 1,
    nodeIds: ['n'],
  })
})

it('space shapes: list and get project the same shared data', async () => {
  const row = {
    ...space,
    targetMountId: 'mount',
    parentSpaceId: null,
    rect: { x: 1, y: 2, width: 3, height: 4 },
    boundary: {
      allowedMountIds: [],
      scopesByMountId: {},
      allowedPluginIds: null,
      capabilities: null,
      trustLevel: null,
    },
    sortOrder: 2,
    nodeIds: ['n'],
    nodes: [],
  }
  const fields =
    'id,name,directoryPath,targetMountId,parentSpaceId,boundary,rect,sortOrder,nodeIds,nodeCount,projectId,nodes'
  const list = identityFixture(false),
    get = identityFixture(false)
  list.values['space.list'] = { projectId: project.id, activeSpaceId: space.id, spaces: [row] }
  get.values['space.get'] = { projectId: project.id, activeSpaceId: space.id, space: row }
  expect(await run(['space', 'list', '--fields', fields], list.io)).toBe(0)
  expect(await run(['space', 'get', '--space', space.id, '--fields', fields], get.io)).toBe(0)
  expect(JSON.parse(list.out()).spaces[0]).toEqual(JSON.parse(get.out()).space)
})

it.each(['get', 'list'])('projects individual geometry fields from space %s', async action => {
  const f = identityFixture(false)
  const row = { ...space, rect: { x: 1, y: 2, width: 3, height: 4 } }
  f.values['space.get'] = { projectId: project.id, space: row }
  f.values['space.list'] = { projectId: project.id, spaces: [row] }
  expect(
    await run(
      [
        'space',
        action,
        ...(action === 'get' ? ['--space', space.id] : []),
        '--fields',
        'rect.x,rect.width',
      ],
      f.io,
    ),
  ).toBe(0)
  const output = JSON.parse(f.out())
  expect(action === 'get' ? output.space : output.spaces[0]).toEqual({ rect: { x: 1, width: 3 } })
})
it.each(['get', 'list'])(
  'space %s help distinguishes canvas geometry from access scope',
  async action => {
    const f = identityFixture(false)
    expect(await run(['space', action, '--help'], f.io)).toBe(0)
    expect(f.out()).toContain('rect')
    expect(f.out()).toContain('{x,y,width,height} in canvas coordinates')
    expect(f.out()).toContain('boundary describes the Space’s access scope')
  },
)
