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
    boundary: { x: 1, y: 2, width: 3, height: 4 },
    sortOrder: 2,
    nodeIds: ['n'],
    nodes: [],
  }
  const fields =
    'id,name,directoryPath,targetMountId,parentSpaceId,boundary,sortOrder,nodeIds,nodeCount,projectId,nodes'
  const list = identityFixture(false),
    get = identityFixture(false)
  list.values['space.list'] = { projectId: project.id, activeSpaceId: space.id, spaces: [row] }
  get.values['space.get'] = { projectId: project.id, activeSpaceId: space.id, space: row }
  expect(await run(['space', 'list', '--fields', fields], list.io)).toBe(0)
  expect(await run(['space', 'get', '--space', space.id, '--fields', fields], get.io)).toBe(0)
  expect(JSON.parse(list.out()).spaces[0]).toEqual(JSON.parse(get.out()).space)
})
