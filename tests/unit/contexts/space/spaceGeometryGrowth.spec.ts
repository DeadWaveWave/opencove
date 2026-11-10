import { expect, it } from 'vitest'
import {
  expandRectToContain,
  growSpaceAncestors,
} from '../../../../src/contexts/space/application/spaceGeometryGrowth'

it('only grows needed edges and is idempotent', () => {
  const current = { x: 0, y: 0, width: 400, height: 300 }
  const content = { x: -10, y: 100, width: 500, height: 80 }
  const grown = expandRectToContain(current, content, 24)
  expect(grown).toEqual({ x: -34, y: 0, width: 548, height: 300 })
  expect(expandRectToContain(grown, content, 24)).toEqual(grown)
  expect(current).toEqual({ x: 0, y: 0, width: 400, height: 300 })
})
it('handles missing ancestors, missing frames and cycles without mutating authority or membership', () => {
  const a = {
    id: 'a',
    parentSpaceId: 'b',
    rect: { x: 10, y: 10, width: 20, height: 20 },
    nodeIds: ['node'],
    boundary: { allowedMountIds: ['mount'] },
  }
  const b = { ...a, id: 'b', parentSpaceId: 'a', rect: null }
  const spaces = [a, b]
  const grown = growSpaceAncestors(spaces, 'a', 18)
  expect(grown[1].rect).toEqual({ x: -8, y: -8, width: 56, height: 56 })
  expect(grown[0]).toBe(a)
  expect(b.rect).toBeNull()
  expect(grown[1].boundary).toBe(b.boundary)
  expect(growSpaceAncestors([a], 'a', 18)).toEqual([a])
  expect(growSpaceAncestors(spaces, 'absent', 18)).toEqual(spaces)
})
