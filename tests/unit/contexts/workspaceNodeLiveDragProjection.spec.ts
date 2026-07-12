import { describe, expect, it } from 'vitest'
import type { WorkspaceSpaceRect } from '../../../src/contexts/workspace/presentation/renderer/types'
import {
  projectWorkspaceNodeLiveDragLayout,
  projectWorkspaceNodePrimaryDragLayout,
} from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useSpaceOwnership.projectLayout'
import { projectWorkspaceNodeLiveDropLayout } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useSpaceOwnership.projectDropLayout'
import { shouldResolveLiveDragSecondaryProjection } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useNodeDragSession.liveProjection'
import {
  createNode,
  createSpace,
  expectInsideSpaceWithPadding,
  expectProjectedPosition,
  intersects,
  rectForPosition,
} from './workspaceNodeProjection.testUtils'

describe('workspace node live drag projection', () => {
  it('throttles only secondary layout work for slow movement', () => {
    const lastProjection = {
      anchorPoint: { x: 100, y: 100 },
      draggedNodeKey: 'drag',
      projectedAtMs: 1_000,
      targetSpaceId: 'space-a',
    }

    expect(
      shouldResolveLiveDragSecondaryProjection({
        lastProjection,
        draggedNodeKey: 'drag',
        anchorPoint: { x: 103, y: 100 },
        nowMs: 1_024,
        targetSpaceId: 'space-a',
      }),
    ).toBe(false)
    expect(
      shouldResolveLiveDragSecondaryProjection({
        lastProjection,
        draggedNodeKey: 'drag',
        anchorPoint: { x: 124, y: 100 },
        nowMs: 1_024,
        targetSpaceId: 'space-a',
      }),
    ).toBe(true)
    expect(
      shouldResolveLiveDragSecondaryProjection({
        lastProjection,
        draggedNodeKey: 'drag',
        anchorPoint: { x: 103, y: 100 },
        nowMs: 1_120,
        targetSpaceId: 'space-a',
      }),
    ).toBe(true)
    expect(
      shouldResolveLiveDragSecondaryProjection({
        lastProjection,
        draggedNodeKey: 'drag',
        anchorPoint: { x: 102, y: 100 },
        nowMs: 1_024,
        targetSpaceId: 'space-b',
      }),
    ).toBe(true)
  })

  it('keeps slow root drags fully outside a Space without horizontal snap-back', () => {
    const spaceRect: WorkspaceSpaceRect = { x: 100, y: 100, width: 400, height: 300 }
    const space = createSpace({ id: 'space', rect: spaceRect, nodeIds: [] })
    const dragNode = createNode({ id: 'drag', position: { x: 560, y: 200 } })
    const nodes = [dragNode]
    let previousPrimaryX = Number.NEGATIVE_INFINITY
    let previousLiveX = Number.NEGATIVE_INFINITY

    for (let step = 0; step <= 4; step += 1) {
      const desiredPosition = { x: 456 + step, y: 200 }
      const input = {
        nodes,
        spaces: [space],
        draggedNodeIds: ['drag'],
        draggedNodePositionById: new Map([['drag', desiredPosition]]),
        dragDx: desiredPosition.x - dragNode.position.x,
        dragDy: 0,
        dropFlowPoint: { x: 501 + step, y: 220 },
      }

      const primary = projectWorkspaceNodePrimaryDragLayout(input)
      const live = projectWorkspaceNodeLiveDragLayout(input)
      const primaryPosition = expectProjectedPosition(primary, 'drag')
      const livePosition = expectProjectedPosition(live, 'drag')

      expect(primary?.targetSpaceId, `primary step ${step}: root target`).toBeNull()
      expect(live?.targetSpaceId, `live step ${step}: root target`).toBeNull()
      expect(
        intersects(rectForPosition(dragNode, primaryPosition), spaceRect),
        `primary step ${step}: active rect must not straddle Space`,
      ).toBe(false)
      expect(
        intersects(rectForPosition(dragNode, livePosition), spaceRect),
        `live step ${step}: active rect must not straddle Space`,
      ).toBe(false)
      expect(
        primaryPosition.x,
        `primary step ${step}: no horizontal backtrack`,
      ).toBeGreaterThanOrEqual(previousPrimaryX)
      expect(livePosition.x, `live step ${step}: no horizontal backtrack`).toBeGreaterThanOrEqual(
        previousLiveX,
      )

      previousPrimaryX = primaryPosition.x
      previousLiveX = livePosition.x
    }
  })

  it('keeps the active window fully inside the target Space padding on every slow edge frame', () => {
    const spaceRect: WorkspaceSpaceRect = { x: 100, y: 100, width: 400, height: 300 }
    const space = createSpace({ id: 'space', rect: spaceRect, nodeIds: ['drag'] })
    const dragNode = createNode({ id: 'drag', position: { x: 220, y: 180 } })
    const nodes = [dragNode]

    for (let step = 0; step <= 4; step += 1) {
      const desiredPosition = { x: 376 + step, y: 180 }
      const input = {
        nodes,
        spaces: [space],
        draggedNodeIds: ['drag'],
        draggedNodePositionById: new Map([['drag', desiredPosition]]),
        dragDx: desiredPosition.x - dragNode.position.x,
        dragDy: 0,
        dropFlowPoint: { x: 495 + step, y: 220 },
      }

      const primary = projectWorkspaceNodePrimaryDragLayout(input)
      const live = projectWorkspaceNodeLiveDragLayout(input)
      const primaryPosition = expectProjectedPosition(primary, 'drag')
      const livePosition = expectProjectedPosition(live, 'drag')

      expect(primary?.targetSpaceId, `primary step ${step}: target`).toBe('space')
      expect(live?.targetSpaceId, `live step ${step}: target`).toBe('space')
      expectInsideSpaceWithPadding(
        rectForPosition(dragNode, primaryPosition),
        spaceRect,
        `primary step ${step}`,
      )
      expectInsideSpaceWithPadding(
        rectForPosition(dragNode, livePosition),
        spaceRect,
        `live step ${step}`,
      )
      expect(livePosition, `live step ${step}: secondary must preserve active`).toEqual(
        primaryPosition,
      )
    }
  })

  it('never lets live peer push-away overwrite the active primary position', () => {
    const spaceRect: WorkspaceSpaceRect = { x: 0, y: 0, width: 700, height: 420 }
    const space = createSpace({ id: 'space', rect: spaceRect, nodeIds: ['drag', 'peer'] })
    const dragNode = createNode({
      id: 'drag',
      position: { x: 80, y: 120 },
      width: 180,
      height: 120,
    })
    const peerNode = createNode({
      id: 'peer',
      position: { x: 360, y: 120 },
      width: 180,
      height: 120,
    })
    const desiredPosition = { x: 260, y: 120 }
    const input = {
      nodes: [dragNode, peerNode],
      spaces: [space],
      draggedNodeIds: ['drag'],
      draggedNodePositionById: new Map([['drag', desiredPosition]]),
      dragDx: desiredPosition.x - dragNode.position.x,
      dragDy: 0,
      dropFlowPoint: { x: 300, y: 180 },
    }

    const primary = projectWorkspaceNodePrimaryDragLayout(input)
    const live = projectWorkspaceNodeLiveDragLayout(input)
    const liveDrop = projectWorkspaceNodeLiveDropLayout(input)
    const primaryPosition = expectProjectedPosition(primary, 'drag')
    const liveActivePosition = expectProjectedPosition(live, 'drag')
    const livePeerPosition = expectProjectedPosition(live, 'peer')
    const liveDropActivePosition = expectProjectedPosition(liveDrop, 'drag')

    expect(liveActivePosition).toEqual(primaryPosition)
    expect(liveDropActivePosition).toEqual(primaryPosition)
    expect(liveDrop.nextSpaces).toBe(input.spaces)
    expect(liveDrop.hasSpaceChange).toBe(false)
    expect(
      intersects(
        rectForPosition(dragNode, liveActivePosition),
        rectForPosition(peerNode, livePeerPosition),
      ),
      'live peer projection should move the peer around the protected active window',
    ).toBe(false)
  })

  it('restores peer layout from the previous target on the next secondary projection', () => {
    const space = createSpace({
      id: 'space-a',
      rect: { x: 0, y: 0, width: 700, height: 400 },
      nodeIds: ['drag', 'peer-a'],
    })
    const dragNode = createNode({
      id: 'drag',
      position: { x: 80, y: 120 },
      width: 180,
      height: 120,
    })
    const peerNode = createNode({
      id: 'peer-a',
      position: { x: 360, y: 120 },
      width: 180,
      height: 120,
    })
    const baselineNodes = [dragNode, peerNode]
    const insideProjection = projectWorkspaceNodeLiveDropLayout({
      nodes: baselineNodes,
      spaces: [space],
      draggedNodeIds: ['drag'],
      draggedNodePositionById: new Map([['drag', { x: 260, y: 120 }]]),
      dragDx: 180,
      dragDy: 0,
      dropFlowPoint: { x: 300, y: 180 },
    })
    const pushedPeerPosition = expectProjectedPosition(insideProjection, 'peer-a')
    expect(pushedPeerPosition).not.toEqual(peerNode.position)

    const liveNodes = baselineNodes.map(node => ({
      ...node,
      position: insideProjection.nextNodePositionById.get(node.id) ?? node.position,
    }))
    const rootProjection = projectWorkspaceNodeLiveDropLayout({
      nodes: baselineNodes,
      spaces: [space],
      draggedNodeIds: ['drag'],
      draggedNodePositionById: new Map([['drag', { x: 760, y: 120 }]]),
      dragDx: 680,
      dragDy: 0,
      dropFlowPoint: { x: 800, y: 180 },
    })
    const restoredNodes = liveNodes.map(node => ({
      ...node,
      position: rootProjection.nextNodePositionById.get(node.id) ?? node.position,
    }))

    expect(rootProjection.targetSpaceId).toBeNull()
    expect(restoredNodes.find(node => node.id === 'peer-a')?.position).toEqual(peerNode.position)
  })

  it('switches parent to child target immediately from the latest pointer position', () => {
    const parentRect: WorkspaceSpaceRect = { x: 0, y: 0, width: 800, height: 500 }
    const childRect: WorkspaceSpaceRect = { x: 320, y: 120, width: 260, height: 220 }
    const parent = createSpace({ id: 'parent', rect: parentRect, nodeIds: ['drag'] })
    const child = createSpace({
      id: 'child',
      rect: childRect,
      nodeIds: [],
      parentSpaceId: 'parent',
    })
    const dragNode = createNode({ id: 'drag', position: { x: 120, y: 170 }, width: 100 })
    const desiredPosition = { x: 280, y: 170 }
    const baseInput = {
      nodes: [dragNode],
      spaces: [parent, child],
      draggedNodeIds: ['drag'],
      draggedNodePositionById: new Map([['drag', desiredPosition]]),
      dragDx: desiredPosition.x - dragNode.position.x,
      dragDy: 0,
    }

    const primaryBefore = projectWorkspaceNodePrimaryDragLayout({
      ...baseInput,
      dropFlowPoint: { x: 319, y: 210 },
    })
    const liveBefore = projectWorkspaceNodeLiveDragLayout({
      ...baseInput,
      dropFlowPoint: { x: 319, y: 210 },
    })
    const primaryAfter = projectWorkspaceNodePrimaryDragLayout({
      ...baseInput,
      dropFlowPoint: { x: 321, y: 210 },
    })
    const liveAfter = projectWorkspaceNodeLiveDragLayout({
      ...baseInput,
      dropFlowPoint: { x: 321, y: 210 },
    })

    expect(primaryBefore?.targetSpaceId).toBe('parent')
    expect(liveBefore?.targetSpaceId).toBe('parent')
    expect(
      intersects(
        rectForPosition(dragNode, expectProjectedPosition(primaryBefore, 'drag')),
        childRect,
      ),
      'parent primary must keep the active window out of the child before pointer entry',
    ).toBe(false)
    expect(
      intersects(rectForPosition(dragNode, expectProjectedPosition(liveBefore, 'drag')), childRect),
      'parent live projection must keep the active window out of the child before pointer entry',
    ).toBe(false)

    expect(primaryAfter?.targetSpaceId).toBe('child')
    expect(liveAfter?.targetSpaceId).toBe('child')
    expectInsideSpaceWithPadding(
      rectForPosition(dragNode, expectProjectedPosition(primaryAfter, 'drag')),
      childRect,
      'child primary after a 2px pointer transition',
    )
    expectInsideSpaceWithPadding(
      rectForPosition(dragNode, expectProjectedPosition(liveAfter, 'drag')),
      childRect,
      'child live after a 2px pointer transition',
    )
  })
})
