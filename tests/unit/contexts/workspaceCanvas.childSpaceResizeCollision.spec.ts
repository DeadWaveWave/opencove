import { describe, expect, it } from 'vitest'
import { projectWorkspaceSpaceDragLayout } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useSpaceDrag.finalize'
import { resolveResizedSpaceRect } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useSpaceDrag.preview'
import type { SpaceDragState } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/types'
import { getCollapsedNodeSize } from '../../../src/contexts/workspace/presentation/renderer/utils/canvasCollapse'
import type { WorkspaceSpaceRect } from '../../../src/contexts/workspace/presentation/renderer/types'
import { createNode, createSpace, intersects } from './workspaceNodeProjection.testUtils'

const parentRect = { x: 0, y: 0, width: 1800, height: 1100 }
const childRect = { x: 100, y: 100, width: 320, height: 240 }

function resizeState(
  initialRect = childRect,
  edges: Extract<SpaceDragState['handle'], { kind: 'resize' }>['edges'] = { right: true },
): SpaceDragState {
  return {
    pointerId: 1,
    spaceId: 'child',
    startFlow: { x: 0, y: 0 },
    startClient: { x: 0, y: 0 },
    shiftKey: false,
    initialRect,
    allNodePositions: new Map(),
    initialNodePositions: new Map(),
    ownedBounds: null,
    minimumSize: { width: 320, height: 240 },
    handle: { kind: 'resize', edges },
  }
}

function fixture(parentNodeIds: string[] = [], rect = childRect) {
  return [
    createSpace({ id: 'parent', rect: parentRect, nodeIds: parentNodeIds }),
    createSpace({ id: 'child', rect, nodeIds: [], parentSpaceId: 'parent' }),
  ]
}

describe('child Space resize collision projection', () => {
  it.each(['parent', 'root'] as const)(
    'pushes a %s-owned window out of the expanded child frame',
    owner => {
      const blocker = createNode({
        id: 'blocker',
        position: { x: 460, y: 120 },
        width: 180,
        height: 100,
      })
      const projected = projectWorkspaceSpaceDragLayout({
        dragState: resizeState(),
        dx: 220,
        dy: 0,
        nodes: [blocker],
        spaces: fixture(owner === 'parent' ? ['blocker'] : []),
        resolveResizedRect: resolveResizedSpaceRect,
      })!

      const resized = projected.nextSpaces.find(space => space.id === 'child')!.rect!
      const blockerRect = { ...blocker.data, ...projected.nextNodePositionById.get('blocker')! }
      expect(resized).toEqual({ ...childRect, width: 540 })
      expect(projected.nextNodePositionById.get('blocker')).toBeDefined()
      expect(intersects(resized, blockerRect)).toBe(false)
      expect(projected.nextSpaces[0].rect).toEqual(parentRect)
    },
  )

  it('moves a sibling subtree as one group while keeping the resized child contents still', () => {
    const siblingRect = { x: 550, y: 100, width: 360, height: 280 }
    const nestedRect = { x: 580, y: 140, width: 180, height: 120 }
    const targetNestedRect = { x: 140, y: 140, width: 180, height: 120 }
    const nestedNode = createNode({ id: 'nested-node', position: { x: 600, y: 160 } })
    const targetNode = createNode({ id: 'target-node', position: { x: 160, y: 160 } })
    const spaces = [
      ...fixture(),
      createSpace({ id: 'sibling', rect: siblingRect, nodeIds: [], parentSpaceId: 'parent' }),
      createSpace({
        id: 'nested',
        rect: nestedRect,
        nodeIds: ['nested-node'],
        parentSpaceId: 'sibling',
      }),
      createSpace({
        id: 'target-nested',
        rect: targetNestedRect,
        nodeIds: ['target-node'],
        parentSpaceId: 'child',
      }),
    ]
    const projected = projectWorkspaceSpaceDragLayout({
      dragState: resizeState(),
      dx: 300,
      dy: 0,
      nodes: [nestedNode, targetNode],
      spaces,
      resolveResizedRect: resolveResizedSpaceRect,
    })!
    const rect = (id: string) => projected.nextSpaces.find(space => space.id === id)!.rect!
    const sibling = rect('sibling')
    const delta = { x: sibling.x - siblingRect.x, y: sibling.y - siblingRect.y }

    expect(intersects(rect('child'), sibling)).toBe(false)
    expect(Math.abs(delta.x) + Math.abs(delta.y)).toBeGreaterThan(0)
    expect(rect('nested')).toEqual({
      ...nestedRect,
      x: nestedRect.x + delta.x,
      y: nestedRect.y + delta.y,
    })
    expect(projected.nextNodePositionById.get('nested-node')).toEqual({
      x: nestedNode.position.x + delta.x,
      y: nestedNode.position.y + delta.y,
    })
    expect(rect('target-nested')).toEqual(targetNestedRect)
    expect(projected.nextNodePositionById.get('target-node') ?? targetNode.position).toEqual(
      targetNode.position,
    )
  })

  it('uses the visible footprint of a compact blocker and preserves its runtime dimensions', () => {
    const compactSize = getCollapsedNodeSize()
    const blocker = createNode({
      id: 'blocker',
      position: { x: 460, y: 120 },
      width: 640,
      height: 480,
    })
    const initialRect = { ...childRect, x: 850 }
    const dragState = resizeState(initialRect, { left: true })
    dragState.collapseState = { collapsedNodeIds: { blocker: true }, collapsedSpaceIds: {} }
    const input = {
      dragState,
      dy: 0,
      nodes: [blocker],
      spaces: fixture(['blocker'], initialRect),
      resolveResizedRect: resolveResizedSpaceRect,
    }
    const clear = projectWorkspaceSpaceDragLayout({ ...input, dx: -200 })!
    expect(clear.nextNodePositionById.get('blocker')).toEqual(blocker.position)

    const overlapping = projectWorkspaceSpaceDragLayout({ ...input, dx: -330 })!
    const compactRect: WorkspaceSpaceRect = {
      ...compactSize,
      ...overlapping.nextNodePositionById.get('blocker')!,
    }
    expect(intersects(overlapping.nextSpaces[1].rect!, compactRect)).toBe(false)
    expect(blocker.data).toMatchObject({ width: 640, height: 480 })
  })

  it.each([0, 20])('restores baseline blocker positions when a live resize retreats to %i', dx => {
    const blocker = createNode({
      id: 'blocker',
      position: { x: 460, y: 120 },
      width: 180,
      height: 100,
    })
    const dragState = resizeState()
    dragState.allNodePositions.set(blocker.id, blocker.position)
    const input = {
      dragState,
      dy: 0,
      nodes: [blocker],
      spaces: fixture(['blocker']),
      resolveResizedRect: resolveResizedSpaceRect,
    }
    const expanded = projectWorkspaceSpaceDragLayout({ ...input, dx: 220 })!
    const previewNode = { ...blocker, position: expanded.nextNodePositionById.get('blocker')! }
    const retreated = projectWorkspaceSpaceDragLayout({ ...input, nodes: [previewNode], dx })!

    expect(expanded.nextNodePositionById.get('blocker')).not.toEqual(blocker.position)
    expect(retreated.nextNodePositionById.get('blocker')).toEqual(blocker.position)
  })

  it('expands enclosing ancestors when displaced siblings cannot stay inside and clears root obstacles', () => {
    const initialRect = { x: 40, y: 40, width: 564, height: 404 }
    const rootBlocker = createNode({
      id: 'root-blocker',
      position: { x: 1000, y: 50 },
      width: 200,
      height: 140,
    })
    const siblingNode = createNode({
      id: 'sibling-node',
      position: { x: 640, y: 60 },
      width: 100,
      height: 100,
    })
    const distantNode = createNode({
      id: 'distant-node',
      position: { x: 1050, y: 450 },
      width: 100,
      height: 100,
    })
    const spaces = [
      createSpace({ id: 'root', rect: { x: 0, y: 0, width: 960, height: 700 }, nodeIds: [] }),
      createSpace({
        id: 'parent',
        rect: { x: 20, y: 20, width: 900, height: 650 },
        nodeIds: [],
        parentSpaceId: 'root',
      }),
      createSpace({ id: 'child', rect: initialRect, nodeIds: [], parentSpaceId: 'parent' }),
      createSpace({
        id: 'sibling',
        rect: { x: 620, y: 40, width: 280, height: 600 },
        nodeIds: ['sibling-node'],
        parentSpaceId: 'parent',
      }),
      createSpace({
        id: 'distant',
        rect: { x: 1000, y: 400, width: 600, height: 440 },
        nodeIds: [],
      }),
      createSpace({
        id: 'distant-child',
        rect: { x: 1030, y: 430, width: 260, height: 180 },
        nodeIds: ['distant-node'],
        parentSpaceId: 'distant',
      }),
    ]
    const nodes = [rootBlocker, siblingNode, distantNode]
    const dragState = resizeState(initialRect)
    dragState.allNodePositions = new Map(nodes.map(node => [node.id, node.position]))
    const projected = projectWorkspaceSpaceDragLayout({
      dragState,
      dx: 260,
      dy: 0,
      spaces,
      nodes,
      resolveResizedRect: resolveResizedSpaceRect,
    })!
    const rect = (id: string) => projected.nextSpaces.find(space => space.id === id)!.rect!
    const contains = (parentId: string, childId: string) => {
      const parent = rect(parentId)
      const child = rect(childId)
      expect(child.x).toBeGreaterThanOrEqual(parent.x)
      expect(child.y).toBeGreaterThanOrEqual(parent.y)
      expect(child.x + child.width).toBeLessThanOrEqual(parent.x + parent.width)
      expect(child.y + child.height).toBeLessThanOrEqual(parent.y + parent.height)
    }
    contains('parent', 'child')
    contains('parent', 'sibling')
    contains('root', 'parent')
    contains('distant', 'distant-child')
    expect(rect('parent').width).toBeGreaterThan(900)
    expect(rect('root').width).toBeGreaterThan(960)
    expect(intersects(rect('root'), rect('distant'))).toBe(false)
    expect(
      intersects(rect('root'), {
        ...rootBlocker.data,
        ...projected.nextNodePositionById.get(rootBlocker.id)!,
      }),
    ).toBe(false)
    const distantDelta = { x: rect('distant').x - 1000, y: rect('distant').y - 400 }
    expect(rect('distant-child')).toMatchObject({
      x: 1030 + distantDelta.x,
      y: 430 + distantDelta.y,
    })
    expect(projected.nextNodePositionById.get('distant-node')).toEqual({
      x: 1050 + distantDelta.x,
      y: 450 + distantDelta.y,
    })
    expect(projected.nextNodePositionById.get('sibling-node')).toEqual({
      x: rect('sibling').x + 20,
      y: rect('sibling').y + 20,
    })

    const reverted = projectWorkspaceSpaceDragLayout({
      dragState,
      dx: 0,
      dy: 0,
      spaces,
      nodes: nodes.map(node => ({
        ...node,
        position: projected.nextNodePositionById.get(node.id) ?? node.position,
      })),
      resolveResizedRect: resolveResizedSpaceRect,
    })!
    expect(reverted.nextSpaces).toEqual(spaces)
    nodes.forEach(node => expect(reverted.nextNodePositionById.get(node.id)).toEqual(node.position))
  })

  it('fits a compact parent without restoring expanded minimum sizes', () => {
    const initialRect = { x: 20, y: 20, width: 224, height: 120 }
    const compact = createNode({
      id: 'compact',
      position: { x: 300, y: 24 },
      width: 640,
      height: 480,
    })
    const dragState = resizeState(initialRect)
    dragState.minimumSize = { width: 224, height: 48 }
    dragState.collapseState = {
      collapsedNodeIds: { compact: true, target: true },
      collapsedSpaceIds: {},
    }
    const target = createNode({ id: 'target', position: { x: 30, y: 24 } })
    const projected = projectWorkspaceSpaceDragLayout({
      dragState,
      dx: 140,
      dy: 0,
      nodes: [compact, target],
      spaces: [
        createSpace({
          id: 'parent',
          rect: { x: 0, y: 0, width: 430, height: 160 },
          nodeIds: ['compact'],
        }),
        createSpace({
          id: 'child',
          rect: initialRect,
          nodeIds: ['target'],
          parentSpaceId: 'parent',
        }),
      ],
      resolveResizedRect: resolveResizedSpaceRect,
    })!
    const parent = projected.nextSpaces[0].rect!
    const blocker = { ...projected.nextNodePositionById.get('compact')!, ...getCollapsedNodeSize() }
    expect(parent.width).toBeLessThan(564)
    expect(parent.height).toBeLessThan(404)
    expect(blocker.x + blocker.width).toBeLessThanOrEqual(parent.x + parent.width)
    expect(compact.data).toMatchObject({ width: 640, height: 480 })
  })
})
