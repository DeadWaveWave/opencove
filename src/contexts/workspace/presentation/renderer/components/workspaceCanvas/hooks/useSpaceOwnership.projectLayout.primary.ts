import type { Node } from '@xyflow/react'
import type { TerminalNodeData, WorkspaceSpaceRect, WorkspaceSpaceState } from '../../../types'
import {
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
import { resolveNearestNonOverlappingRectWithinBounds } from './useSpaceOwnership.projectLayout.bounded.placeRect'

export interface ProjectedNodePrimaryDragLayout {
  targetSpaceId: string | null
  targetSpaceRect: WorkspaceSpaceRect | null
  nextNodePositionById: Map<string, { x: number; y: number }>
  constrainedDraggedNodes: Array<Node<TerminalNodeData>>
  childSpaceObstacleItems: LayoutItem[]
  directions: LayoutDirection[]
  dropCenter: { x: number; y: number }
}

export interface ProjectWorkspaceNodeDragLayoutInput {
  nodes: Array<Node<TerminalNodeData>>
  spaces: WorkspaceSpaceState[]
  draggedNodeIds: string[]
  draggedNodePositionById: Map<string, { x: number; y: number }>
  dragDx?: number
  dragDy?: number
  dropFlowPoint?: { x: number; y: number } | null
}

export function buildWorkspaceDragDirectionPreference(dx: number, dy: number): LayoutDirection[] {
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

function applyDelta(
  nodes: Array<Node<TerminalNodeData>>,
  delta: { dx: number; dy: number },
): Array<Node<TerminalNodeData>> {
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
    const insideDelta = resolveDeltaToKeepRectInsideRect(
      dropRect,
      targetSpaceRect,
      SPACE_NODE_PADDING,
    )
    const insideDraggedNodes = applyDelta(draggedNodes, insideDelta)
    const insideDropRect = {
      ...dropRect,
      x: dropRect.x + insideDelta.dx,
      y: dropRect.y + insideDelta.dy,
    }

    return applyDelta(
      insideDraggedNodes,
      resolveDeltaToKeepRectOutsideRects(
        insideDropRect,
        obstacleItems.map(item => item.rect),
      ),
    )
  }

  return applyDelta(draggedNodes, {
    dx: placedDropRect.x - dropRect.x,
    dy: placedDropRect.y - dropRect.y,
  })
}

export function projectWorkspaceNodePrimaryDragLayout({
  nodes,
  spaces,
  draggedNodeIds,
  draggedNodePositionById,
  dragDx = 0,
  dragDy = 0,
  dropFlowPoint,
}: ProjectWorkspaceNodeDragLayoutInput): ProjectedNodePrimaryDragLayout | null {
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
      return desiredPosition ? { ...node, position: desiredPosition } : node
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
    draggedNodeIds.length > 1
      ? dropCenter
      : dropFlowPoint && Number.isFinite(dropFlowPoint.x) && Number.isFinite(dropFlowPoint.y)
        ? dropFlowPoint
        : dropCenter
  const targetSpace = resolveSpaceAtPoint(spaces, dropTargetPoint)
  const targetSpaceId = targetSpace?.id ?? null
  const targetSpaceRect = targetSpace?.rect ?? null
  const directions = buildWorkspaceDragDirectionPreference(dragDx, dragDy)
  const childSpaceObstacleItems = targetSpaceId
    ? buildChildSpaceObstacleItems(spaces, targetSpaceId)
    : []

  const constrainedDraggedNodes =
    targetSpaceId && targetSpaceRect
      ? resolveDraggedNodesWithinTargetSpace({
          draggedNodes,
          dropRect,
          targetSpaceRect,
          obstacleItems: childSpaceObstacleItems,
          directions,
        })
      : applyDelta(
          draggedNodes,
          resolveDeltaToKeepRectOutsideRects(
            dropRect,
            spaces
              .map(space => space.rect)
              .filter((rect): rect is WorkspaceSpaceRect => Boolean(rect)),
          ),
        )

  return {
    targetSpaceId,
    targetSpaceRect,
    nextNodePositionById: new Map(
      constrainedDraggedNodes.map(node => [node.id, { ...node.position }]),
    ),
    constrainedDraggedNodes,
    childSpaceObstacleItems,
    directions,
    dropCenter,
  }
}
