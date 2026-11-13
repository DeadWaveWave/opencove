// @vitest-environment node
import { expect, it } from 'vitest'
import { fixture } from './nodeControlNear.helpers'
import {
  workspaceWithNode,
  resolvePlacement,
} from '../../../src/contexts/workspace/application/nodeControl/nodeCreatePlacement'
import { nearGrowthRanker } from '../../../src/contexts/workspace/application/nodeControl/nodeCreateSpaceGrowth'
import { nodeNearSpaceRects } from '../../../src/contexts/workspace/application/nodeControl/nodeNearSpaceRects'
import { isRectInsideRect } from '../../../src/contexts/space/application/spaceContainment'

type Rect = { x: number; y: number; width: number; height: number }
function intersects(a: Rect, b: Rect) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}
it('prefers no growth over the compact right anchor that needs growth', async () => {
  const f = fixture(),
    w = f.state().workspaces[0]
  w.spaces[0].rect = { x: 2800, y: 1800, width: 700, height: 1000 }
  const before = structuredClone(w)
  const { node } = await f.run()
  expect(node.frame).toMatchObject({ x: 3000, y: 2224 })
  expect(f.state().workspaces[0].spaces[0].rect).toEqual(before.spaces[0].rect)
  expect(f.state().workspaces[0].nodes[0]).toEqual(before.nodes[0])
})
it('reproduces Trial 2 and chooses safe horizontal growth instead of growing Main into Docs', () => {
  const f = fixture(),
    w = f.state().workspaces[0],
    template = w.nodes[0]
  w.nodes = [
    { ...template, id: 'reference', position: { x: 980, y: 90 }, width: 520, height: 420 },
    { ...template, id: 'brief', position: { x: 80, y: 90 }, width: 280, height: 300 },
    { ...template, id: 'reviewer', position: { x: 420, y: 90 }, width: 520, height: 520 },
    { ...template, id: 'note', position: { x: 1524, y: 90 }, width: 276, height: 188 },
    { ...template, id: 'terminal', position: { x: 1524, y: 302 }, width: 564, height: 388 },
  ]
  w.spaces[0].nodeIds = w.nodes.map(n => n.id)
  w.spaces[0].rect = { x: 20, y: 20, width: 2092, height: 820 }
  const docs = { x: 20, y: 1000, width: 800, height: 500 }
  w.spaces.push({ ...w.spaces[0], id: 'docs', nodeIds: [], rect: docs })
  const before = structuredClone(w)
  const placed = resolvePlacement({
    workspace: w,
    space: w.spaces[0],
    kind: 'agent',
    bucket: 'large',
    reference: w.nodes[0],
  })
  expect(placed.size).toEqual({ width: 564, height: 788 })
  expect(placed.placement).toEqual({ x: 2112, y: 90 })
  const committed = workspaceWithNode(
    w,
    { ...template, id: 'created-agent', position: placed.placement, ...placed.size },
    w.spaces[0].id,
    true,
  )
  expect(intersects(committed.spaces[0].rect!, docs)).toBe(false)
  expect(isRectInsideRect({ ...placed.placement, ...placed.size }, committed.spaces[0].rect!)).toBe(
    true,
  )
  expect(committed.nodes.slice(0, -1)).toEqual(before.nodes)
  expect(w).toEqual(before)
})
it.each([false, true])(
  'checks growth of every ancestor against unrelated Spaces (null ancestor=%s)',
  async missing => {
    const f = fixture(),
      w = f.state().workspaces[0],
      ref = w.nodes[0]
    ref.position = { x: 1000, y: 1000 }
    w.spaces[0].rect = { x: 976, y: 976, width: 348, height: 248 }
    w.spaces[0].parentSpaceId = 'parent'
    w.spaces.push({
      ...w.spaces[0],
      id: 'parent',
      nodeIds: [],
      parentSpaceId: 'grand',
      rect: missing ? null : { x: 950, y: 950, width: 398, height: 298 },
    })
    w.spaces.push({
      ...w.spaces[1],
      id: 'grand',
      parentSpaceId: null,
      rect: missing ? null : { x: 926, y: 926, width: 446, height: 346 },
    })
    // Right growth is safe for the child, but the padded grandparent would hit this Space.
    const obstacle = { x: 1615, y: 950, width: 200, height: 200 }
    w.spaces.push({
      ...w.spaces[0],
      id: 'obstacle',
      nodeIds: [],
      parentSpaceId: null,
      rect: obstacle,
    })
    const { node } = await f.run()
    expect(node.frame).toMatchObject({ x: 1000, y: 1224 })
    const next = f.state().workspaces[0]
    next.spaces.slice(0, 3).forEach(s => expect(intersects(s.rect!, obstacle)).toBe(false))
    expect(isRectInsideRect(node.frame, next.spaces[0].rect!)).toBe(true)
    expect(isRectInsideRect(next.spaces[0].rect!, next.spaces[1].rect!)).toBe(true)
    expect(isRectInsideRect(next.spaces[1].rect!, next.spaces[2].rect!)).toBe(true)
  },
)
it('places with the clamped requested size, including size-only frames at root', async () => {
  for (const root of [false, true]) {
    const f = fixture()
    if (root) {
      f.state().workspaces[0].spaces = []
    }
    // eslint-disable-next-line no-await-in-loop
    const { node } = await f.run({ kind: 'agent', frame: { width: 520, height: 420 } })
    expect(node.frame).toMatchObject({ width: 520, height: 520 })
    const ref = f.state().workspaces[0].nodes[0]
    expect(intersects(node.frame, { ...ref.position, width: ref.width, height: ref.height })).toBe(
      false,
    )
  }
})

it('retains compact placement as the final tier when every growth envelope already overlaps a neighbour', async () => {
  const f = fixture(),
    w = f.state().workspaces[0]
  w.spaces[0].rect = { x: 2976, y: 1976, width: 348, height: 248 }
  w.spaces.push({
    ...w.spaces[0],
    id: 'existing-overlap',
    nodeIds: [],
    rect: { x: 2976, y: 1976, width: 10, height: 10 },
  })
  const { node } = await f.run()
  expect(node.frame).toMatchObject({ x: 3324, y: 2000 })
})
it('recomputes growth tiers when a neighbour moves during a CAS conflict', async () => {
  const f = fixture(),
    w = f.state().workspaces[0],
    write = f.writeAppState.getMockImplementation()!
  w.nodes[0].position = { x: 1000, y: 1000 }
  w.spaces[0].rect = { x: 976, y: 976, width: 348, height: 248 }
  w.spaces[0].parentSpaceId = 'parent'
  w.spaces.push({
    ...w.spaces[0],
    id: 'parent',
    parentSpaceId: null,
    nodeIds: [],
    rect: { x: 950, y: 950, width: 398, height: 298 },
  })
  w.spaces.push({
    ...w.spaces[0],
    id: 'neighbour',
    parentSpaceId: null,
    nodeIds: [],
    rect: { x: 5000, y: 950, width: 200, height: 200 },
  })
  f.writeAppState.mockImplementationOnce(async (next, options) => {
    f.advance(state => {
      state.workspaces[0].spaces[2].rect!.x = 1615
    })
    return write(next, options)
  })
  const { node } = await f.run()
  expect(node.frame).toMatchObject({ x: 1000, y: 1224 })
  expect(f.writeAppState).toHaveBeenCalledTimes(2)
})

it('checks collisions with the requested applied size rather than the default size', async () => {
  const f = fixture(),
    w = f.state().workspaces[0]
  w.nodes.push({
    ...structuredClone(w.nodes[0]),
    id: 'obstacle',
    position: { x: 3588, y: 2000 },
    width: 200,
    height: 600,
  })
  const { node } = await f.run({ frame: { width: 360, height: 260 } })
  expect(node.frame).toMatchObject({ width: 360, height: 260 })
  w.nodes.forEach(n =>
    expect(intersects(node.frame, { ...n.position, width: n.width, height: n.height })).toBe(false),
  )
})

it('prefers an interior slot from the existing bounded search when compact edge anchors would all grow', async () => {
  const f = fixture(),
    w = f.state().workspaces[0]
  w.spaces[0].rect = { x: 1000, y: 1000, width: 2350, height: 1250 }
  w.nodes.push({
    ...structuredClone(w.nodes[0]),
    id: 'left-wall',
    position: { x: 1024, y: 1900 },
    width: 1952,
    height: 326,
  })
  const before = structuredClone(w.spaces[0].rect)
  const { node } = await f.run()
  expect(f.state().workspaces[0].spaces[0].rect).toEqual(before)
  expect(node.frame.y).toBeLessThan(w.nodes[0].position.y)
  expect(isRectInsideRect(node.frame, before)).toBe(true)
})

it.each(['target', 'ancestor'] as const)(
  'treats unchanged effective bounds as no growth with a null %s rectangle',
  async missing => {
    const f = fixture(),
      w = f.state().workspaces[0]
    w.nodes.push({
      ...structuredClone(w.nodes[0]),
      id: 'existing-content',
      position: { x: 2800, y: 2700 },
      width: 220,
      height: 140,
    })
    w.spaces[0].nodeIds.push('existing-content')
    const expectedTarget = { x: 2776, y: 1976, width: 564, height: 888 }
    w.spaces[0].rect = missing === 'target' ? null : expectedTarget
    if (missing === 'ancestor') {
      w.spaces[0].parentSpaceId = 'ancestor'
      w.spaces.push({
        ...w.spaces[0],
        id: 'ancestor',
        nodeIds: [],
        parentSpaceId: null,
        rect: null,
      })
    }
    const effective = nodeNearSpaceRects(w),
      before = structuredClone(w)
    expect(effective.get('space')).toEqual(expectedTarget)
    const { node } = await f.run()
    expect(node.frame).toMatchObject({ x: 3000, y: 2224 })
    const next = f.state().workspaces[0]
    next.spaces.forEach(space => expect(space.rect).toEqual(effective.get(space.id)))
    expect(next.nodes.slice(0, -1)).toEqual(before.nodes)
    expect(w).toEqual(before)
    const rank = nearGrowthRanker(w, 'space', effective)
    expect(rank(node.frame)).toBe(0)
    expect(rank({ ...node.frame, x: 3324, y: 2000 })).toBe(1)
  },
)
it('uses derived bounds of a null-rect sibling when distinguishing safe from intersecting growth', () => {
  const f = fixture(),
    w = f.state().workspaces[0]
  w.spaces[0].rect = { x: 1000, y: 1000, width: 5000, height: 1250 }
  w.nodes.push({
    ...structuredClone(w.nodes[0]),
    id: 'sibling-member',
    position: { x: 1024, y: 2424 },
    width: 220,
    height: 140,
  })
  w.spaces.push({ ...w.spaces[0], id: 'sibling', nodeIds: ['sibling-member'], rect: null })
  const effective = nodeNearSpaceRects(w),
    before = structuredClone(w)
  expect(effective.get('sibling')).toMatchObject({ x: 1000, y: 2400 })
  const rank = nearGrowthRanker(w, 'space', effective)
  expect(rank({ x: 3324, y: 2000, width: 252, height: 172 })).toBe(0)
  expect(rank({ x: 6000, y: 2000, width: 252, height: 172 })).toBe(1)
  // The new node misses both the sibling's content and effective rect, but the grown target intersects it.
  const below = { x: 3000, y: 2224, width: 252, height: 172 }
  expect(intersects(below, effective.get('sibling')!)).toBe(false)
  expect(rank(below)).toBe(2)
  expect(w).toEqual(before)
})
