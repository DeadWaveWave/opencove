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
  type Rect,
} from './useSpaceOwnership.helpers'
import { resolveSpaceAtPoint } from './useSpaceOwnership.drop.helpers'
import { buildOwningSpaceIdByNodeId } from './workspaceLayoutPolicy'

export interface ProjectedNodeDragLayout {
  targetSpaceId: string | null
  nextNodePositionById: Map<string, { x: number; y: number }>
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

function clampNodeRectInsideSpace(nodeRect: Rect, spaceRect: WorkspaceSpaceRect): Rect {
  const { dx, dy } = resolveDeltaToKeepRectInsideRect(nodeRect, spaceRect, SPACE_NODE_PADDING)
  if (dx === 0 && dy === 0) {
    return nodeRect
  }

  return {
    ...nodeRect,
    x: nodeRect.x + dx,
    y: nodeRect.y + dy,
  }
}

function clampItemsInsideTargetSpace({
  items,
  targetSpaceRect,
  pinnedSet,
}: {
  items: LayoutItem[]
  targetSpaceRect: WorkspaceSpaceRect
  pinnedSet: Set<string>
}): { items: LayoutItem[]; hasClampChange: boolean } {
  let hasClampChange = false

  const nextItems = items.map(item => {
    if (item.kind !== 'node' || pinnedSet.has(item.groupId)) {
      return item
    }

    const clamped = clampNodeRectInsideSpace(item.rect, targetSpaceRect)
    if (clamped.x === item.rect.x && clamped.y === item.rect.y) {
      return item
    }

    hasClampChange = true
    return { ...item, rect: clamped }
  })

  return { items: nextItems, hasClampChange }
}

export function projectWorkspaceNodeDragLayout({
  nodes,
  spaces,
  draggedNodeIds,
  draggedNodePositionById,
  dragDx = 0,
  dragDy = 0,
}: {
  nodes: Node<TerminalNodeData>[]
  spaces: WorkspaceSpaceState[]
  draggedNodeIds: string[]
  draggedNodePositionById: Map<string, { x: number; y: number }>
  dragDx?: number
  dragDy?: number
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

  const targetSpace = resolveSpaceAtPoint(spaces, dropCenter)
  const targetSpaceId = targetSpace?.id ?? null
  const targetSpaceRect = targetSpace?.rect ?? null

  const owningSpaceIdByNodeId = buildOwningSpaceIdByNodeId(spaces)
  const draggedNodeIdSet = new Set(draggedNodeIds)

  const otherNodes =
    targetSpaceId && targetSpaceRect
      ? nodes.filter(
          node =>
            !draggedNodeIdSet.has(node.id) && owningSpaceIdByNodeId.get(node.id) === targetSpaceId,
        )
      : nodes.filter(node => !draggedNodeIdSet.has(node.id) && !owningSpaceIdByNodeId.has(node.id))

  const { dx: baseDx, dy: baseDy } =
    targetSpaceRect !== null
      ? resolveDeltaToKeepRectInsideRect(dropRect, targetSpaceRect, SPACE_NODE_PADDING)
      : resolveDeltaToKeepRectOutsideRects(
          dropRect,
          spaces
            .map(space => space.rect)
            .filter((rect): rect is WorkspaceSpaceRect => Boolean(rect)),
        )

  const constrainedDraggedNodes = applyDelta(draggedNodes, { dx: baseDx, dy: baseDy })

  const pinnedNodeIds = constrainedDraggedNodes.map(node => node.id)
  const pinnedSet = new Set(pinnedNodeIds)

  const directions = buildDragDirectionPreference(dragDx, dragDy)

  const spaceItems = targetSpaceId ? [] : buildSpaceRectItems(spaces)
  const pinnedSpaceIds = targetSpaceId
    ? []
    : spaces.filter(space => Boolean(space.rect)).map(space => space.id)

  const solveOnce = (items: LayoutItem[]): LayoutItem[] =>
    pushAwayLayout({
      items,
      pinnedGroupIds: [...pinnedNodeIds, ...pinnedSpaceIds],
      sourceGroupIds: pinnedNodeIds,
      directions,
      gap: 0,
      bounds: targetSpaceRect ? { rect: targetSpaceRect, padding: SPACE_NODE_PADDING } : undefined,
    })

  const buildItems = (
    dragged: Array<Node<TerminalNodeData>>,
    others: Array<Node<TerminalNodeData>>,
  ) => [...spaceItems, ...buildNodeItems([...dragged, ...others])]

  let items = buildItems(constrainedDraggedNodes, otherNodes)
  let pushed = solveOnce(items)

  if (targetSpaceRect) {
    // Clamp can introduce new overlaps (multiple nodes snapped to the same edge). Iterate a bit more
    // and always finish on a push-away pass when clamp changes occur to reduce boundary stacking.
    const maxIterations = 16
    for (let iteration = 0; iteration < maxIterations; iteration += 1) {
      const { items: clampedItems, hasClampChange } = clampItemsInsideTargetSpace({
        items: pushed,
        targetSpaceRect,
        pinnedSet,
      })
      if (!hasClampChange) {
        pushed = clampedItems
        break
      }

      pushed = solveOnce(clampedItems)
    }

    const { items: finalClamped, hasClampChange: finalClampChanged } = clampItemsInsideTargetSpace({
      items: pushed,
      targetSpaceRect,
      pinnedSet,
    })

    pushed = finalClamped

    if (finalClampChanged) {
      pushed = solveOnce(pushed)
      pushed = clampItemsInsideTargetSpace({
        items: pushed,
        targetSpaceRect,
        pinnedSet,
      }).items
    }
  }

  const nextNodePositionById = new Map(
    pushed
      .filter(item => item.kind === 'node')
      .map(item => [item.id, { x: item.rect.x, y: item.rect.y }]),
  )

  return { targetSpaceId, nextNodePositionById }
}
