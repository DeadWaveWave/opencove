import { expect, it } from 'vitest'
import { nodeNearSpaceRects } from '../../../src/contexts/workspace/application/nodeControl/nodeNearSpaceRects'
import { workspaceWithNode } from '../../../src/contexts/workspace/application/nodeControl/nodeCreatePlacement'
import { fixture, concurrentNote } from './nodeControlNear.helpers'
import { isRectInsideRect } from '../../../src/contexts/space/application/spaceContainment'

it('derives null bounds bottom-up from descendants and siblings regardless of record order, seeding only the insertion branch', () => {
  const w = fixture().state().workspaces[0]
  const template = w.spaces[0]
  w.nodes.push({ ...concurrentNote('sibling-content'), position: { x: -4000, y: -3000 } })
  w.spaces = [
    { ...template, id: 'parent', nodeIds: [], parentSpaceId: null, rect: null },
    { ...template, parentSpaceId: 'parent', rect: null },
    { ...template, id: 'sibling', nodeIds: [], parentSpaceId: 'parent', rect: null },
    {
      ...template,
      id: 'grandchild',
      nodeIds: ['sibling-content', 'stale-id'],
      parentSpaceId: 'sibling',
      rect: null,
    },
    { ...template, id: 'empty', nodeIds: [], parentSpaceId: null, rect: null },
  ]
  const before = structuredClone(w)
  const rects = nodeNearSpaceRects(w)
  expect(rects.get('empty')).toBeNull()
  expect(isRectInsideRect(rects.get('grandchild')!, rects.get('sibling')!)).toBe(true)
  expect(isRectInsideRect(rects.get('sibling')!, rects.get('parent')!)).toBe(true)
  const inserted = { ...concurrentNote('new'), position: { x: 3350, y: 2000 } }
  const next = workspaceWithNode(w, inserted, 'space', true)
  expect(isRectInsideRect(rects.get('parent')!, next.spaces[0].rect!)).toBe(true)
  expect(isRectInsideRect(rects.get('space')!, next.spaces[1].rect!)).toBe(true)
  expect(next.spaces.slice(2).map(s => s.rect)).toEqual([null, null, null])
  expect(w).toEqual(before)
})
it('does not replace existing rectangles or attempt to repair cyclic hierarchies', () => {
  const w = fixture().state().workspaces[0]
  const existing = w.spaces[0].rect
  w.spaces.push({
    ...w.spaces[0],
    id: 'empty-cycle',
    nodeIds: [],
    parentSpaceId: 'empty-cycle',
    rect: null,
  })
  expect(nodeNearSpaceRects(w).get('space')).toBe(existing)
  expect(nodeNearSpaceRects(w).get('empty-cycle')).toBeNull()
})
