import { expect, it } from 'vitest'
import {
  resolvePlacement,
  workspaceWithNode,
} from '../../../src/contexts/workspace/application/nodeControl/nodeCreatePlacement'
import type {
  NodeControlNode,
  NodeControlSpace,
  NodeControlWorkspace,
} from '../../../src/contexts/workspace/application/nodeControl/nodeControlState'
import { isRectInsideRect } from '../../../src/contexts/space/application/spaceContainment'
import { SPACE_NODE_PADDING as padding } from '../../../src/contexts/workspace/domain/workspaceSpaceLayout'

const childRect = { x: 62, y: 72, width: 420, height: 336 }
function fixture(parentWidth = 1500) {
  return {
    nodes: [{ id: 'brief', position: { x: 80, y: 90 }, width: 280, height: 300 }],
    spaces: [
      { id: 'main', nodeIds: [], rect: { x: 20, y: 20, width: parentWidth, height: 600 } },
      { id: 'child', parentSpaceId: 'main', nodeIds: ['brief'], rect: childRect },
    ],
  } as unknown as NodeControlWorkspace
}
function place(workspace: NodeControlWorkspace) {
  return resolvePlacement({
    workspace,
    space: workspace.spaces[1],
    kind: 'note',
    bucket: 'regular',
  })
}
function expectPadded(container: NodeControlSpace, rect: typeof childRect) {
  expect(
    isRectInsideRect(
      {
        x: rect.x - padding,
        y: rect.y - padding,
        width: rect.width + padding * 2,
        height: rect.height + padding * 2,
      },
      container.rect!,
    ),
  ).toBe(true)
}
it('places a new note to the right of a full child inside its roomy parent', () => {
  const w = fixture()
  const result = place(w)
  expect(result.placement.x).toBeGreaterThanOrEqual(childRect.x + childRect.width)
  const node = { id: 'new', position: result.placement, ...result.size } as NodeControlNode
  const next = workspaceWithNode(w, node, 'child')
  expectPadded(next.spaces[1], { ...node.position, ...result.size })
  expectPadded(next.spaces[0], next.spaces[1].rect!)
  expect(isRectInsideRect(next.spaces[1].rect!, w.spaces[0].rect!)).toBe(true)
  expect(next.spaces.map(s => s.nodeIds)).toEqual([[], ['brief', 'new']])
  expect(w.nodes).toHaveLength(1)
  expect(w.spaces[1].rect).toEqual(childRect)
})
it('grows two ancestor levels without moving existing nodes or shrinking any boundary', () => {
  const w = fixture(470)
  w.spaces[0].parentSpaceId = 'grandparent'
  w.spaces.push({
    id: 'grandparent',
    nodeIds: [],
    rect: { x: 0, y: 0, width: 510, height: 650 },
  } as NodeControlSpace)
  const result = place(w)
  const next = workspaceWithNode(
    w,
    { id: 'new', position: result.placement, ...result.size } as NodeControlNode,
    'child',
  )
  expectPadded(next.spaces[0], next.spaces[1].rect!)
  expectPadded(next.spaces[2], next.spaces[0].rect!)
  next.spaces.forEach((s, i) => expect(isRectInsideRect(w.spaces[i].rect!, s.rect!)).toBe(true))
  expect(next.nodes[0]).toEqual(w.nodes[0])
})
it('uses an available complete internal slot first', () => {
  const w = fixture()
  w.nodes = []
  expect(place(w).placement).toEqual({ x: 86, y: 96 })
})
it('tries below when the entire right search is blocked instead of choosing the nearby left', () => {
  const w = fixture()
  w.spaces.push({
    id: 'obstacle',
    nodeIds: [],
    rect: { x: 482, y: -5000, width: 5000, height: 10000 },
  } as NodeControlSpace)
  const result = place(w)
  expect(result.placement.x).toBeGreaterThanOrEqual(childRect.x)
  expect(result.placement.y).toBeGreaterThanOrEqual(childRect.y + childRect.height)
})
it('continues searching right when only the nearest right slot is blocked', () => {
  const w = fixture()
  w.nodes.push({
    id: 'block',
    position: { x: 506, y: -2400 },
    width: 30,
    height: 5000,
  } as NodeControlNode)
  expect(place(w).placement.x).toBeGreaterThanOrEqual(536)
})
