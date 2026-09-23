import { describe, expect, it } from 'vitest'
import type { WorkspaceSpaceState } from '@contexts/workspace/presentation/renderer/types'
import { planNodeExpansion } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/collapse/planNodeExpansion'
import { SPACE_NODE_PADDING } from '@contexts/workspace/presentation/renderer/utils/spaceLayout'
import { createNode, createSpace } from '../contexts/workspaceNodeProjection.testUtils'

function corridorWalls(parentSpaceId?: string): WorkspaceSpaceState[] {
  return [
    createSpace({
      id: 'left-wall',
      parentSpaceId,
      nodeIds: [],
      rect: { x: -10_000, y: -10_000, width: 10_000, height: 20_000 },
    }),
    createSpace({
      id: 'right-wall',
      parentSpaceId,
      nodeIds: [],
      rect: { x: 224, y: -10_000, width: 9776, height: 20_000 },
    }),
  ]
}

describe('find-space expansion beyond the creation search radius', () => {
  it('finds room beyond tall Space walls even when there are no peer nodes', () => {
    const nodes = [
      createNode({ id: 'target', position: { x: 24, y: 24 }, width: 640, height: 480 }),
    ]
    const spaces = corridorWalls()
    const plan = planNodeExpansion(
      'target',
      nodes,
      spaces,
      { collapsedNodeIds: { target: true }, collapsedSpaceIds: {} },
      'find-space',
    )!

    expect(plan.nodes[0].position.x).toBeGreaterThanOrEqual(10_000 + SPACE_NODE_PADDING * 2)
    expect(plan.spaces).toEqual(spaces)
    expect(plan.nodes[0].data).toBe(nodes[0].data)
    expect(plan.state.collapsedNodeIds.target).toBeUndefined()
  })

  it('grows a packed nested owner without changing ownership or moving its compact peer', () => {
    const nodes = [
      createNode({ id: 'target', position: { x: 24, y: 24 }, width: 640, height: 480 }),
      createNode({ id: 'peer', position: { x: 24, y: 180 }, width: 640, height: 480 }),
    ]
    const parent = createSpace({
      id: 'parent',
      nodeIds: [],
      rect: { x: -10_024, y: -10_024, width: 20_048, height: 20_048 },
    })
    const owner = createSpace({
      id: 'owner',
      parentSpaceId: 'parent',
      nodeIds: ['target', 'peer'],
      rect: { x: 0, y: 0, width: 224, height: 320 },
    })
    const walls = corridorWalls('parent')
    const spaces = [parent, owner, ...walls]
    const plan = planNodeExpansion(
      'target',
      nodes,
      spaces,
      { collapsedNodeIds: { target: true, peer: true }, collapsedSpaceIds: {} },
      'find-space',
    )!

    expect(plan.nodes[0].position.x).toBeGreaterThanOrEqual(10_000 + SPACE_NODE_PADDING * 2)
    expect(plan.nodes[1]).toBe(nodes[1])
    expect(plan.nodes[0].data).toBe(nodes[0].data)
    expect(plan.spaces.map(space => [space.id, space.parentSpaceId, space.nodeIds])).toEqual(
      spaces.map(space => [space.id, space.parentSpaceId, space.nodeIds]),
    )
    const nextOwner = plan.spaces[1].rect!
    const nextParent = plan.spaces[0].rect!
    expect(nextOwner.x + nextOwner.width).toBeGreaterThanOrEqual(plan.nodes[0].position.x + 640)
    expect(nextParent.x + nextParent.width).toBeGreaterThanOrEqual(nextOwner.x + nextOwner.width)
    // Growing the owner across its siblings must move those regions out of its
    // expanded frame, while retaining their identity, dimensions and ownership.
    const nextWalls = plan.spaces.slice(2)
    expect(nextWalls.map(space => ({ ...space, rect: null }))).toEqual(
      walls.map(space => ({ ...space, rect: null })),
    )
    nextWalls.forEach((wall, index) => {
      expect(wall.rect!.width).toBe(walls[index].rect!.width)
      expect(wall.rect!.height).toBe(walls[index].rect!.height)
    })
    const siblingRects = plan.spaces.slice(1).map(space => space.rect!)
    siblingRects.forEach((rect, index) => {
      expect(rect.x).toBeGreaterThanOrEqual(nextParent.x + SPACE_NODE_PADDING)
      expect(rect.y).toBeGreaterThanOrEqual(nextParent.y + SPACE_NODE_PADDING)
      expect(rect.x + rect.width).toBeLessThanOrEqual(
        nextParent.x + nextParent.width - SPACE_NODE_PADDING,
      )
      expect(rect.y + rect.height).toBeLessThanOrEqual(
        nextParent.y + nextParent.height - SPACE_NODE_PADDING,
      )
      for (const peer of siblingRects.slice(index + 1)) {
        expect(
          rect.x + rect.width <= peer.x ||
            peer.x + peer.width <= rect.x ||
            rect.y + rect.height <= peer.y ||
            peer.y + peer.height <= rect.y,
        ).toBe(true)
      }
    })
    expect(plan.state.collapsedNodeIds).toEqual({ peer: true })
  })
})
