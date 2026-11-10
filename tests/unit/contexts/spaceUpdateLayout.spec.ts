import { afterEach, expect, it, vi } from 'vitest'
import * as geometryGrowth from '../../../src/contexts/space/application/spaceGeometryGrowth'
import { planSpaceUpdate } from '../../../src/contexts/workspace/application/nodeControl/spaceUpdateLayout'
import { normalizePersistedAppState } from '../../../src/platform/persistence/sqlite/normalize'

function workspace() {
  return normalizePersistedAppState({
    formatVersion: 1,
    settings: {},
    activeWorkspaceId: 'p',
    workspaces: [
      {
        id: 'p',
        name: 'Project',
        path: '/repo',
        nodes: [
          {
            id: 'parent-note',
            kind: 'note',
            position: { x: -300, y: -200 },
            width: 240,
            height: 180,
          },
        ],
        spaces: [
          { id: 'root', nodeIds: [], rect: { x: 0, y: 0, width: 1000, height: 800 } },
          {
            id: 'parent',
            parentSpaceId: 'root',
            nodeIds: ['parent-note'],
            rect: { x: 20, y: 20, width: 800, height: 600 },
          },
          {
            id: 'target',
            parentSpaceId: 'parent',
            nodeIds: [],
            rect: { x: 40, y: 40, width: 400, height: 300 },
          },
          {
            id: 'sibling',
            parentSpaceId: 'parent',
            nodeIds: [],
            rect: { x: 1100, y: 900, width: 100, height: 100 },
          },
        ],
      },
    ],
  })!.workspaces[0]
}

afterEach(() => vi.restoreAllMocks())

it('delegates enclosing rectangles and ancestor propagation to the shared growth rules', () => {
  const expand = vi.spyOn(geometryGrowth, 'expandRectToContain')
  const grow = vi.spyOn(geometryGrowth, 'growSpaceAncestors')
  planSpaceUpdate(workspace(), { spaceId: 'target', frame: { width: 1400 } })
  expect(expand).toHaveBeenCalled()
  expect(grow).toHaveBeenCalledExactlyOnceWith(expect.any(Array), 'target', 12)
})

it('fits existing ancestor contents before propagating the updated child without moving siblings', () => {
  const initial = workspace()
  const result = planSpaceUpdate(initial, { spaceId: 'target', frame: { width: 1400 } })
  expect(result.workspace.spaces[1].rect).toEqual({ x: -324, y: -224, width: 1776, height: 1236 })
  expect(result.workspace.spaces[0].rect).toEqual({ x: -336, y: -236, width: 1800, height: 1260 })
  expect(result.workspace.spaces[3]).toBe(initial.spaces[3])
  expect(result.workspace.nodes).toEqual(initial.nodes)
  expect(initial.spaces[1].rect).toEqual({ x: 20, y: 20, width: 800, height: 600 })
})

it('preserves the missing-ancestor-frame error rather than inventing an update baseline', () => {
  const initial = workspace()
  initial.spaces[1].rect = null
  expect(() => planSpaceUpdate(initial, { spaceId: 'target', frame: { x: 100 } })).toThrow(
    expect.objectContaining({
      code: 'common.invalid_input',
      debugMessage: expect.stringContaining('An ancestor space has no canvas boundary.'),
    }),
  )
})

it('rejects overflow introduced by ancestor contents before returning a layout to persist', () => {
  const initial = workspace()
  initial.nodes[0].position.x = -Number.MAX_VALUE
  initial.spaces[3].rect!.x = Number.MAX_VALUE
  expect(() => planSpaceUpdate(initial, { spaceId: 'target', frame: { width: 1400 } })).toThrow(
    expect.objectContaining({
      code: 'common.invalid_input',
      debugMessage: 'The requested space frame exceeds the supported canvas coordinates.',
    }),
  )
})

it('rejects overflow created by shared ancestor propagation', () => {
  const initial = workspace()
  initial.spaces[1].rect = {
    x: -Number.MAX_VALUE / 2,
    y: 20,
    width: Number.MAX_VALUE / 2,
    height: 600,
  }
  expect(() =>
    planSpaceUpdate(initial, {
      spaceId: 'target',
      frame: { x: Number.MAX_VALUE / 2, width: Number.MAX_VALUE / 2 },
    }),
  ).toThrow(
    expect.objectContaining({
      code: 'common.invalid_input',
      debugMessage: 'The requested space frame exceeds the supported canvas coordinates.',
    }),
  )
})
