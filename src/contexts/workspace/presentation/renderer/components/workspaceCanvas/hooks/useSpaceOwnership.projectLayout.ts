import type { Node } from '@xyflow/react'
import type { TerminalNodeData, WorkspaceSpaceState } from '../../../types'
import { pushAwayLayout, SPACE_NODE_PADDING, type LayoutItem } from '../../../utils/spaceLayout'
import { resolveBoundedSpaceNodeLayout } from './useSpaceOwnership.projectLayout.bounded'
import { resolveLiveTargetSpaceLayout } from './useSpaceOwnership.projectLayout.live'
import {
  buildWorkspaceDragDirectionPreference,
  projectWorkspaceNodePrimaryDragLayout,
  type ProjectedNodePrimaryDragLayout,
  type ProjectWorkspaceNodeDragLayoutInput,
} from './useSpaceOwnership.projectLayout.primary'
import { buildOwningSpaceIdByNodeId } from './workspaceLayoutPolicy'

export { projectWorkspaceNodePrimaryDragLayout } from './useSpaceOwnership.projectLayout.primary'

export interface ProjectedNodeDragLayout {
  targetSpaceId: string | null
  nextNodePositionById: Map<string, { x: number; y: number }>
  nextSpaces: WorkspaceSpaceState[]
}

type ProjectionStrategy = 'live' | 'final'

function buildSpaceRectItems(spaces: WorkspaceSpaceState[]): LayoutItem[] {
  return spaces
    .filter(space => Boolean(space.rect))
    .map(space => ({
      id: space.id,
      kind: 'space' as const,
      groupId: space.id,
      rect: { ...space.rect! },
    }))
}

function buildNodeItems(nodes: Array<Node<TerminalNodeData>>): LayoutItem[] {
  return nodes.map(node => ({
    id: node.id,
    kind: 'node' as const,
    groupId: node.id,
    rect: {
      x: node.position.x,
      y: node.position.y,
      width: node.data.width,
      height: node.data.height,
    },
  }))
}

function collectProjectedNodePositions(items: LayoutItem[]): Map<string, { x: number; y: number }> {
  return new Map(
    items
      .filter(item => item.kind === 'node')
      .map(item => [item.id, { x: item.rect.x, y: item.rect.y }]),
  )
}

function projectRootNodeLayout({
  nodes,
  spaces,
  primary,
  draggedNodeIdSet,
  dragDx,
  dragDy,
}: {
  nodes: Array<Node<TerminalNodeData>>
  spaces: WorkspaceSpaceState[]
  primary: ProjectedNodePrimaryDragLayout
  draggedNodeIdSet: Set<string>
  dragDx: number
  dragDy: number
}): ProjectedNodeDragLayout {
  const owningSpaceIdByNodeId = buildOwningSpaceIdByNodeId(spaces)
  const otherNodes = nodes.filter(
    node => !draggedNodeIdSet.has(node.id) && !owningSpaceIdByNodeId.has(node.id),
  )
  const pinnedNodeIds = primary.constrainedDraggedNodes.map(node => node.id)
  const spaceItems = buildSpaceRectItems(spaces)
  const pinnedSpaceIds = spaces.filter(space => Boolean(space.rect)).map(space => space.id)
  const rootDirections = buildWorkspaceDragDirectionPreference(Math.abs(dragDx), Math.abs(dragDy))
  const pushed = pushAwayLayout({
    items: [...spaceItems, ...buildNodeItems([...primary.constrainedDraggedNodes, ...otherNodes])],
    pinnedGroupIds: [...pinnedNodeIds, ...pinnedSpaceIds],
    sourceGroupIds: pinnedNodeIds,
    directions: rootDirections,
    gap: 0,
  })

  return {
    targetSpaceId: primary.targetSpaceId,
    nextNodePositionById: collectProjectedNodePositions(pushed),
    nextSpaces: spaces,
  }
}

function projectTargetSpaceNodeLayout({
  nodes,
  spaces,
  primary,
  draggedNodeIdSet,
  dragDx,
  dragDy,
  strategy,
}: {
  nodes: Array<Node<TerminalNodeData>>
  spaces: WorkspaceSpaceState[]
  primary: ProjectedNodePrimaryDragLayout
  draggedNodeIdSet: Set<string>
  dragDx: number
  dragDy: number
  strategy: ProjectionStrategy
}): ProjectedNodeDragLayout {
  const targetSpaceId = primary.targetSpaceId!
  const targetSpaceRect = primary.targetSpaceRect!
  const owningSpaceIdByNodeId = buildOwningSpaceIdByNodeId(spaces)
  const otherNodes = nodes.filter(
    node => !draggedNodeIdSet.has(node.id) && owningSpaceIdByNodeId.get(node.id) === targetSpaceId,
  )
  const pinnedNodeIds = primary.constrainedDraggedNodes.map(node => node.id)
  const nodeItems = buildNodeItems([...primary.constrainedDraggedNodes, ...otherNodes])

  if (strategy === 'live') {
    const childObstacleGroupIds = primary.childSpaceObstacleItems.map(item => item.groupId)
    const projected = resolveLiveTargetSpaceLayout({
      items: [...primary.childSpaceObstacleItems, ...nodeItems],
      pinnedGroupIds: [...pinnedNodeIds, ...childObstacleGroupIds],
      sourceGroupIds: [...pinnedNodeIds, ...childObstacleGroupIds],
      directions: primary.directions,
      targetSpaceRect,
    })

    return {
      targetSpaceId,
      nextNodePositionById: collectProjectedNodePositions(projected),
      nextSpaces: spaces,
    }
  }

  const bounded = resolveBoundedSpaceNodeLayout({
    items: nodeItems,
    pinnedNodeIds,
    targetSpaceRect,
    dropCenter: primary.dropCenter,
    directions: primary.directions,
    dragDx,
    dragDy,
  })
  const pushed =
    bounded ??
    pushAwayLayout({
      items: nodeItems,
      pinnedGroupIds: pinnedNodeIds,
      sourceGroupIds: pinnedNodeIds,
      directions: primary.directions,
      gap: 0,
    })
  const projected =
    primary.childSpaceObstacleItems.length > 0
      ? pushAwayLayout({
          items: [...primary.childSpaceObstacleItems, ...pushed],
          pinnedGroupIds: [
            ...pinnedNodeIds,
            ...primary.childSpaceObstacleItems.map(item => item.groupId),
          ],
          sourceGroupIds: [
            ...pinnedNodeIds,
            ...primary.childSpaceObstacleItems.map(item => item.groupId),
          ],
          directions: primary.directions,
          gap: 0,
          bounds: { rect: targetSpaceRect, padding: SPACE_NODE_PADDING },
        })
      : pushed

  return {
    targetSpaceId,
    nextNodePositionById: collectProjectedNodePositions(projected),
    nextSpaces: spaces,
  }
}

function projectWorkspaceNodeDragLayoutWithStrategy(
  input: ProjectWorkspaceNodeDragLayoutInput,
  strategy: ProjectionStrategy,
): ProjectedNodeDragLayout | null {
  const primary = projectWorkspaceNodePrimaryDragLayout(input)
  if (!primary) {
    return null
  }

  const dragDx = input.dragDx ?? 0
  const dragDy = input.dragDy ?? 0
  const draggedNodeIdSet = new Set(input.draggedNodeIds)

  const projected =
    primary.targetSpaceId && primary.targetSpaceRect
      ? projectTargetSpaceNodeLayout({
          nodes: input.nodes,
          spaces: input.spaces,
          primary,
          draggedNodeIdSet,
          dragDx,
          dragDy,
          strategy,
        })
      : projectRootNodeLayout({
          nodes: input.nodes,
          spaces: input.spaces,
          primary,
          draggedNodeIdSet,
          dragDx,
          dragDy,
        })

  if (strategy !== 'live') {
    return projected
  }

  const nextNodePositionById = new Map(projected.nextNodePositionById)
  primary.nextNodePositionById.forEach((position, nodeId) => {
    nextNodePositionById.set(nodeId, position)
  })

  return { ...projected, nextNodePositionById }
}

export function projectWorkspaceNodeLiveDragLayout(
  input: ProjectWorkspaceNodeDragLayoutInput,
): ProjectedNodeDragLayout | null {
  return projectWorkspaceNodeDragLayoutWithStrategy(input, 'live')
}

export function projectWorkspaceNodeDragLayout(
  input: ProjectWorkspaceNodeDragLayoutInput,
): ProjectedNodeDragLayout | null {
  return projectWorkspaceNodeDragLayoutWithStrategy(input, 'final')
}
