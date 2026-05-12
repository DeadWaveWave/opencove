import { describe, expect, it } from 'vitest'
import type { Node } from '@xyflow/react'
import { resolveResizedSpaceRect } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useSpaceDrag.preview'
import { projectWorkspaceSpaceDragLayout } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useSpaceDrag.finalize'
import type { SpaceDragState } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/types'
import type {
  TerminalNodeData,
  WorkspaceSpaceRect,
  WorkspaceSpaceState,
} from '../../../src/contexts/workspace/presentation/renderer/types'

function makeNode(id: string, rect: WorkspaceSpaceRect): Node<TerminalNodeData> {
  return {
    id,
    type: 'terminal',
    position: { x: rect.x, y: rect.y },
    data: {
      sessionId: id,
      title: id,
      width: rect.width,
      height: rect.height,
      kind: 'terminal',
      status: 'running',
      startedAt: null,
      endedAt: null,
      exitCode: null,
      lastError: null,
      scrollback: null,
      agent: null,
      task: null,
      note: null,
      image: null,
      document: null,
      website: null,
    },
  }
}

function makeSpace(
  id: string,
  rect: WorkspaceSpaceRect,
  options?: { parentSpaceId?: string | null; nodeIds?: string[] },
): WorkspaceSpaceState {
  return {
    id,
    name: id,
    directoryPath: '/workspace',
    targetMountId: null,
    parentSpaceId: options?.parentSpaceId ?? null,
    boundary: null,
    sortOrder: 0,
    labelColor: null,
    nodeIds: options?.nodeIds ?? [],
    rect,
  }
}

function makeMoveDragState(options: {
  spaceId: string
  initialRect: WorkspaceSpaceRect
  nodes: Node<TerminalNodeData>[]
  movableNodeIds?: string[]
}): SpaceDragState {
  return {
    pointerId: 1,
    spaceId: options.spaceId,
    startFlow: { x: 0, y: 0 },
    startClient: { x: 0, y: 0 },
    shiftKey: false,
    initialRect: options.initialRect,
    allNodePositions: new Map(
      options.nodes.map(node => [node.id, { x: node.position.x, y: node.position.y }]),
    ),
    initialNodePositions: new Map(
      (options.movableNodeIds ?? []).map(nodeId => {
        const node = options.nodes.find(candidate => candidate.id === nodeId)
        if (!node) {
          throw new Error(`missing node ${nodeId}`)
        }

        return [nodeId, { x: node.position.x, y: node.position.y }] as const
      }),
    ),
    ownedBounds: null,
    handle: { kind: 'move' },
  }
}

function makeResizeDragState(options: {
  spaceId: string
  initialRect: WorkspaceSpaceRect
  ownedBounds: NonNullable<SpaceDragState['ownedBounds']>
  edges: Extract<SpaceDragState['handle'], { kind: 'resize' }>['edges']
}): SpaceDragState {
  return {
    pointerId: 1,
    spaceId: options.spaceId,
    startFlow: { x: 0, y: 0 },
    startClient: { x: 0, y: 0 },
    shiftKey: false,
    initialRect: options.initialRect,
    allNodePositions: new Map(),
    initialNodePositions: new Map(),
    ownedBounds: options.ownedBounds,
    handle: { kind: 'resize', edges: options.edges },
  }
}

function rectOf(spaces: WorkspaceSpaceState[], id: string): WorkspaceSpaceRect {
  const rect = spaces.find(space => space.id === id)?.rect
  if (!rect) {
    throw new Error(`missing rect for ${id}`)
  }

  return rect
}

function overlaps(a: WorkspaceSpaceRect, b: WorkspaceSpaceRect): boolean {
  return a.x + a.width > b.x && a.x < b.x + b.width && a.y + a.height > b.y && a.y < b.y + b.height
}

function rectFromProjectedNode(
  node: Node<TerminalNodeData>,
  projectedPosition: { x: number; y: number } | undefined,
): WorkspaceSpaceRect {
  const position = projectedPosition ?? node.position
  return {
    x: position.x,
    y: position.y,
    width: node.data.width,
    height: node.data.height,
  }
}

describe('workspace child space drag layout', () => {
  it('moves child spaces and child-owned nodes with their parent space', () => {
    const parentRect = { x: 100, y: 100, width: 420, height: 320 }
    const childRect = { x: 180, y: 170, width: 180, height: 120 }
    const childNode = makeNode('child-node', { x: 210, y: 205, width: 120, height: 80 })
    const spaces = [
      makeSpace('parent', parentRect),
      makeSpace('child', childRect, { parentSpaceId: 'parent', nodeIds: ['child-node'] }),
    ]

    const projected = projectWorkspaceSpaceDragLayout({
      dragState: makeMoveDragState({
        spaceId: 'parent',
        initialRect: parentRect,
        nodes: [childNode],
      }),
      dx: 140,
      dy: 80,
      nodes: [childNode],
      spaces,
      resolveResizedRect: resolveResizedSpaceRect,
    })

    expect(projected).not.toBeNull()
    expect(rectOf(projected!.nextSpaces, 'parent')).toEqual({ ...parentRect, x: 240, y: 180 })
    expect(rectOf(projected!.nextSpaces, 'child')).toEqual({ ...childRect, x: 320, y: 250 })
    expect(projected!.nextNodePositionById.get('child-node')).toEqual({ x: 350, y: 285 })
  })

  it('keeps parent resizing from cutting into descendant child spaces', () => {
    const parentRect = { x: 100, y: 100, width: 520, height: 360 }
    const childRect = { x: 150, y: 150, width: 210, height: 150 }
    const spaces = [
      makeSpace('parent', parentRect),
      makeSpace('child', childRect, { parentSpaceId: 'parent' }),
    ]

    const projected = projectWorkspaceSpaceDragLayout({
      dragState: makeResizeDragState({
        spaceId: 'parent',
        initialRect: parentRect,
        ownedBounds: {
          left: childRect.x,
          top: childRect.y,
          right: childRect.x + childRect.width,
          bottom: childRect.y + childRect.height,
        },
        edges: { left: true, top: true },
      }),
      dx: 360,
      dy: 260,
      nodes: [],
      spaces,
      resolveResizedRect: resolveResizedSpaceRect,
    })

    const nextParent = rectOf(projected!.nextSpaces, 'parent')
    const nextChild = rectOf(projected!.nextSpaces, 'child')
    expect(nextParent.x).toBeLessThanOrEqual(childRect.x)
    expect(nextParent.y).toBeLessThanOrEqual(childRect.y)
    expect(nextParent.x + nextParent.width).toBeGreaterThanOrEqual(childRect.x + childRect.width)
    expect(nextParent.y + nextParent.height).toBeGreaterThanOrEqual(childRect.y + childRect.height)
    expect(nextChild).toEqual(childRect)
  })

  it('keeps root blockers clear when a parent with child spaces is moved over them', () => {
    const parentRect = { x: 100, y: 100, width: 360, height: 260 }
    const childRect = { x: 190, y: 170, width: 170, height: 110 }
    const rootBlocker = makeNode('root-blocker', { x: 520, y: 120, width: 240, height: 180 })
    const spaces = [
      makeSpace('parent', parentRect),
      makeSpace('child', childRect, { parentSpaceId: 'parent' }),
    ]

    const projected = projectWorkspaceSpaceDragLayout({
      dragState: makeMoveDragState({
        spaceId: 'parent',
        initialRect: parentRect,
        nodes: [rootBlocker],
      }),
      dx: 420,
      dy: 0,
      nodes: [rootBlocker],
      spaces,
      resolveResizedRect: resolveResizedSpaceRect,
    })

    const nextParent = rectOf(projected!.nextSpaces, 'parent')
    const nextChild = rectOf(projected!.nextSpaces, 'child')
    const nextBlockerPosition = projected!.nextNodePositionById.get('root-blocker')
    expect(nextBlockerPosition).toBeDefined()
    const nextBlocker = {
      ...nextBlockerPosition!,
      width: rootBlocker.data.width,
      height: rootBlocker.data.height,
    }
    expect(overlaps(nextBlocker, nextParent)).toBe(false)
    expect(overlaps(nextBlocker, nextChild)).toBe(false)
  })

  it('moves child spaces when their parent is pushed away by another space collision', () => {
    const moverRect = { x: 100, y: 100, width: 320, height: 240 }
    const parentRect = { x: 500, y: 100, width: 360, height: 260 }
    const childRect = { x: 590, y: 170, width: 170, height: 110 }
    const spaces = [
      makeSpace('mover', moverRect),
      makeSpace('parent', parentRect),
      makeSpace('child', childRect, { parentSpaceId: 'parent' }),
    ]

    const projected = projectWorkspaceSpaceDragLayout({
      dragState: makeMoveDragState({
        spaceId: 'mover',
        initialRect: moverRect,
        nodes: [],
      }),
      dx: 400,
      dy: 0,
      nodes: [],
      spaces,
      resolveResizedRect: resolveResizedSpaceRect,
    })

    const nextMover = rectOf(projected!.nextSpaces, 'mover')
    const nextParent = rectOf(projected!.nextSpaces, 'parent')
    const nextChild = rectOf(projected!.nextSpaces, 'child')
    const parentDx = nextParent.x - parentRect.x
    const parentDy = nextParent.y - parentRect.y

    expect(overlaps(nextMover, nextParent)).toBe(false)
    expect(Math.abs(parentDx) + Math.abs(parentDy)).toBeGreaterThan(0)
    expect(nextChild.x - childRect.x).toBe(parentDx)
    expect(nextChild.y - childRect.y).toBe(parentDy)
  })

  it('pushes same-parent child spaces and nodes away when a child space is moved', () => {
    const parentRect = { x: 100, y: 100, width: 760, height: 420 }
    const movingChildRect = { x: 160, y: 170, width: 180, height: 120 }
    const siblingChildRect = { x: 380, y: 170, width: 180, height: 120 }
    const parentNode = makeNode('parent-node', { x: 430, y: 190, width: 120, height: 80 })
    const spaces = [
      makeSpace('parent', parentRect, { nodeIds: ['parent-node'] }),
      makeSpace('moving-child', movingChildRect, { parentSpaceId: 'parent' }),
      makeSpace('sibling-child', siblingChildRect, { parentSpaceId: 'parent' }),
    ]

    const projected = projectWorkspaceSpaceDragLayout({
      dragState: makeMoveDragState({
        spaceId: 'moving-child',
        initialRect: movingChildRect,
        nodes: [parentNode],
      }),
      dx: 140,
      dy: 0,
      nodes: [parentNode],
      spaces,
      resolveResizedRect: resolveResizedSpaceRect,
    })

    expect(projected).not.toBeNull()
    const nextMovingChild = rectOf(projected!.nextSpaces, 'moving-child')
    const nextSiblingChild = rectOf(projected!.nextSpaces, 'sibling-child')
    const nextParentNode = rectFromProjectedNode(
      parentNode,
      projected!.nextNodePositionById.get('parent-node'),
    )

    expect(nextMovingChild.x).toBe(movingChildRect.x + 140)
    expect(overlaps(nextMovingChild, nextSiblingChild)).toBe(false)
    expect(overlaps(nextMovingChild, nextParentNode)).toBe(false)
    expect(overlaps(nextSiblingChild, nextParentNode)).toBe(false)
  })
})
