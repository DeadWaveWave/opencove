import type { Node } from '@xyflow/react'
import type { TerminalNodeData, WorkspaceSpaceRect, WorkspaceSpaceState } from '../../../types'
import {
  pushAwayLayout,
  SPACE_NODE_PADDING,
  type LayoutDirection,
  type LayoutItem,
} from '../../../utils/spaceLayout'
import {
  computeBoundingRect,
  resolveDeltaToKeepRectInsideRect,
  resolveDeltaToKeepRectOutsideRects,
} from './useSpaceOwnership.helpers'
import { resolveSpaceAtPoint } from './useSpaceOwnership.drop.helpers'
import { resolveBoundedSpaceNodeLayout } from './useSpaceOwnership.projectLayout.bounded'
import { resolveNearestNonOverlappingRectWithinBounds } from './useSpaceOwnership.projectLayout.bounded.placeRect'
import { buildOwningSpaceIdByNodeId } from './workspaceLayoutPolicy'

export interface ProjectedNodeDragLayout {
  targetSpaceId: string | null
  nextNodePositionById: Map<string, { x: number; y: number }>
  nextSpaces: WorkspaceSpaceState[]
}

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

function buildChildSpaceObstacleItems(
  spaces: WorkspaceSpaceState[],
  parentSpaceId: string,
): LayoutItem[] {
  return spaces
    .filter(space => (space.parentSpaceId ?? null) === parentSpaceId && Boolean(space.rect))
    .map(space => ({
      id: space.id,
      kind: 'space' as const,
      groupId: `space:${space.id}`,
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

function buildDragDirectionPreference(dx: number, dy: number): LayoutDirection[] {
  const ordered: LayoutDirection[] = []
  const xDirection = dx >= 0 ? ('x+' as const) : ('x-' as const)
  const yDirection = dy >= 0 ? ('y+' as const) : ('y-' as const)

  if (Math.abs(dx) >= Math.abs(dy)) {
    ordered.push(xDirection, yDirection)
  } else {
    ordered.push(yDirection, xDirection)
  }

  if (!ordered.includes('x+')) {
    ordered.push('x+')
  }
  if (!ordered.includes('x-')) {
    ordered.push('x-')
  }
  if (!ordered.includes('y+')) {
    ordered.push('y+')
  }
  if (!ordered.includes('y-')) {
    ordered.push('y-')
  }

  return ordered
}

function applyDelta(nodes: Array<Node<TerminalNodeData>>, delta: { dx: number; dy: number }) {
  if (delta.dx === 0 && delta.dy === 0) {
    return nodes
  }

  return nodes.map(node => ({
    ...node,
    position: {
      x: node.position.x + delta.dx,
      y: node.position.y + delta.dy,
    },
  }))
}

function resolveDraggedNodesWithinTargetSpace({
  draggedNodes,
  dropRect,
  targetSpaceRect,
  obstacleItems,
  directions,
}: {
  draggedNodes: Array<Node<TerminalNodeData>>
  dropRect: WorkspaceSpaceRect
  targetSpaceRect: WorkspaceSpaceRect
  obstacleItems: LayoutItem[]
  directions: LayoutDirection[]
}): Array<Node<TerminalNodeData>> {
  if (obstacleItems.length === 0) {
    const { dx, dy } = resolveDeltaToKeepRectInsideRect(
      dropRect,
      targetSpaceRect,
      SPACE_NODE_PADDING,
    )
    return applyDelta(draggedNodes, { dx, dy })
  }

  const placedDropRect = resolveNearestNonOverlappingRectWithinBounds({
    desired: dropRect,
    obstacles: obstacleItems.map(item => item.rect),
    bounds: {
      left: targetSpaceRect.x + SPACE_NODE_PADDING,
      top: targetSpaceRect.y + SPACE_NODE_PADDING,
      right: targetSpaceRect.x + targetSpaceRect.width - SPACE_NODE_PADDING,
      bottom: targetSpaceRect.y + targetSpaceRect.height - SPACE_NODE_PADDING,
    },
    directions,
  })

  if (!placedDropRect) {
    const { dx, dy } = resolveDeltaToKeepRectInsideRect(
      dropRect,
      targetSpaceRect,
      SPACE_NODE_PADDING,
    )
    return applyDelta(draggedNodes, { dx, dy })
  }

  return applyDelta(draggedNodes, {
    dx: placedDropRect.x - dropRect.x,
    dy: placedDropRect.y - dropRect.y,
  })
}

export function projectWorkspaceNodeDragLayout({
  nodes,
  spaces,
  draggedNodeIds,
  draggedNodePositionById,
  dragDx = 0,
  dragDy = 0,
  dropFlowPoint,
}: {
  nodes: Node<TerminalNodeData>[]
  spaces: WorkspaceSpaceState[]
  draggedNodeIds: string[]
  draggedNodePositionById: Map<string, { x: number; y: number }>
  dragDx?: number
  dragDy?: number
  dropFlowPoint?: { x: number; y: number } | null
}): ProjectedNodeDragLayout | null {
  if (draggedNodeIds.length === 0) {
    return null
  }

  const nodeById = new Map(nodes.map(node => [node.id, node]))
  const draggedNodes = draggedNodeIds
    .map(nodeId => {
      const node = nodeById.get(nodeId)
      if (!node) {
        return null
      }

      const desiredPosition = draggedNodePositionById.get(nodeId)
      if (!desiredPosition) {
        return node
      }

      if (node.position.x === desiredPosition.x && node.position.y === desiredPosition.y) {
        return node
      }

      return {
        ...node,
        position: desiredPosition,
      }
    })
    .filter((node): node is Node<TerminalNodeData> => Boolean(node))

  const dropRect = computeBoundingRect(draggedNodes)
  if (!dropRect) {
    return null
  }

  const dropCenter = {
    x: dropRect.x + dropRect.width * 0.5,
    y: dropRect.y + dropRect.height * 0.5,
  }

  const dropTargetPoint =
    dropRect && draggedNodeIds.length > 1
      ? dropCenter
      : dropFlowPoint && Number.isFinite(dropFlowPoint.x) && Number.isFinite(dropFlowPoint.y)
        ? dropFlowPoint
        : dropCenter

  const targetSpace = resolveSpaceAtPoint(spaces, dropTargetPoint)
  const targetSpaceId = targetSpace?.id ?? null
  const targetSpaceRect = targetSpace?.rect ?? null

  const owningSpaceIdByNodeId = buildOwningSpaceIdByNodeId(spaces)
  const draggedNodeIdSet = new Set(draggedNodeIds)

  const directions = buildDragDirectionPreference(dragDx, dragDy)

  if (!targetSpaceId || !targetSpaceRect) {
    const otherNodes = nodes.filter(
      node => !draggedNodeIdSet.has(node.id) && !owningSpaceIdByNodeId.has(node.id),
    )

    const { dx: baseDx, dy: baseDy } = resolveDeltaToKeepRectOutsideRects(
      dropRect,
      spaces.map(space => space.rect).filter((rect): rect is WorkspaceSpaceRect => Boolean(rect)),
    )

    const constrainedDraggedNodes = applyDelta(draggedNodes, { dx: baseDx, dy: baseDy })
    const pinnedNodeIds = constrainedDraggedNodes.map(node => node.id)

    const spaceItems = buildSpaceRectItems(spaces)
    const pinnedSpaceIds = spaces.filter(space => Boolean(space.rect)).map(space => space.id)
    const rootDirections = buildDragDirectionPreference(Math.abs(dragDx), Math.abs(dragDy))

    const pushed = pushAwayLayout({
      items: [...spaceItems, ...buildNodeItems([...constrainedDraggedNodes, ...otherNodes])],
      pinnedGroupIds: [...pinnedNodeIds, ...pinnedSpaceIds],
      sourceGroupIds: pinnedNodeIds,
      directions: rootDirections,
      gap: 0,
    })

    const nextNodePositionById = new Map(
      pushed
        .filter(item => item.kind === 'node')
        .map(item => [item.id, { x: item.rect.x, y: item.rect.y }]),
    )

    return { targetSpaceId, nextNodePositionById, nextSpaces: spaces }
  }

  const otherNodes = nodes.filter(
    node => !draggedNodeIdSet.has(node.id) && owningSpaceIdByNodeId.get(node.id) === targetSpaceId,
  )

  const childSpaceObstacleItems = buildChildSpaceObstacleItems(spaces, targetSpaceId)
  const constrainedDraggedNodes = resolveDraggedNodesWithinTargetSpace({
    draggedNodes,
    dropRect,
    targetSpaceRect,
    obstacleItems: childSpaceObstacleItems,
    directions,
  })

  const pinnedNodeIds = constrainedDraggedNodes.map(node => node.id)

  const items = buildNodeItems([...constrainedDraggedNodes, ...otherNodes])
  const bounded = resolveBoundedSpaceNodeLayout({
    items,
    pinnedNodeIds,
    targetSpaceRect,
    dropCenter,
    directions,
    dragDx,
    dragDy,
  })
  const pushed =
    bounded ??
    pushAwayLayout({
      items,
      pinnedGroupIds: pinnedNodeIds,
      sourceGroupIds: pinnedNodeIds,
      directions,
      gap: 0,
    })

  const projected =
    childSpaceObstacleItems.length > 0
      ? pushAwayLayout({
          items: [...childSpaceObstacleItems, ...pushed],
          pinnedGroupIds: [...pinnedNodeIds, ...childSpaceObstacleItems.map(item => item.groupId)],
          sourceGroupIds: [...pinnedNodeIds, ...childSpaceObstacleItems.map(item => item.groupId)],
          directions,
          gap: 0,
          bounds: { rect: targetSpaceRect, padding: SPACE_NODE_PADDING },
        })
      : pushed

  const nextNodePositionById = new Map(
    projected
      .filter(item => item.kind === 'node')
      .map(item => [item.id, { x: item.rect.x, y: item.rect.y }]),
  )

  return { targetSpaceId, nextNodePositionById, nextSpaces: spaces }
}
