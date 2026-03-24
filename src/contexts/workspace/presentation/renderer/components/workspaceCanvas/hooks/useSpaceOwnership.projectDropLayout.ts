import type { Node } from '@xyflow/react'
import type { TerminalNodeData, WorkspaceSpaceRect, WorkspaceSpaceState } from '../../../types'
import { SPACE_MIN_SIZE, SPACE_NODE_PADDING } from '../../../utils/spaceLayout'
import { expandSpaceToFitOwnedNodesAndPushAway } from '../../../utils/spaceAutoResize'
import { reassignNodesAcrossSpaces } from './useSpaceOwnership.drop.helpers'
import { projectWorkspaceNodeDragLayout } from './useSpaceOwnership.projectLayout'

export interface WorkspaceNodeDropProjectionCache {
  baselineSpaces: WorkspaceSpaceState[]
  targetSpaceId: string
  expandedRect: WorkspaceSpaceRect
  nextSpaceRectById: Map<string, WorkspaceSpaceRect>
  movedNodePositionById: Map<string, { x: number; y: number }>
}

export interface ProjectedWorkspaceNodeDropLayout {
  targetSpaceId: string | null
  nextNodePositionById: Map<string, { x: number; y: number }>
  nextSpaces: WorkspaceSpaceState[]
  hasSpaceChange: boolean
  nextCache: WorkspaceNodeDropProjectionCache | null
}

export function projectWorkspaceNodeDropLayout({
  nodes,
  spaces,
  draggedNodeIds,
  draggedNodePositionById,
  dragDx = 0,
  dragDy = 0,
  dropFlowPoint,
  previousCache = null,
}: {
  nodes: Node<TerminalNodeData>[]
  spaces: WorkspaceSpaceState[]
  draggedNodeIds: string[]
  draggedNodePositionById: Map<string, { x: number; y: number }>
  dragDx?: number
  dragDy?: number
  dropFlowPoint?: { x: number; y: number } | null
  previousCache?: WorkspaceNodeDropProjectionCache | null
}): ProjectedWorkspaceNodeDropLayout {
  if (draggedNodeIds.length === 0) {
    return {
      targetSpaceId: null,
      nextNodePositionById: new Map(),
      nextSpaces: spaces,
      hasSpaceChange: false,
      nextCache: null,
    }
  }

  const projectedDrag = projectWorkspaceNodeDragLayout({
    nodes,
    spaces,
    draggedNodeIds,
    draggedNodePositionById,
    dragDx,
    dragDy,
    dropFlowPoint,
  })

  if (!projectedDrag) {
    const nextNodePositionById = new Map(
      nodes.map(node => {
        const desired = draggedNodePositionById.get(node.id) ?? null
        return [
          node.id,
          {
            x: desired?.x ?? node.position.x,
            y: desired?.y ?? node.position.y,
          },
        ] as const
      }),
    )

    return {
      targetSpaceId: null,
      nextNodePositionById,
      nextSpaces: spaces,
      hasSpaceChange: false,
      nextCache: null,
    }
  }

  const targetSpaceId = projectedDrag.targetSpaceId

  const { nextSpaces: reassignedSpaces, hasSpaceChange } = reassignNodesAcrossSpaces({
    spaces,
    nodeIds: draggedNodeIds,
    targetSpaceId,
  })

  let nodeRects: Array<{ id: string; rect: WorkspaceSpaceRect }> = nodes.map(node => {
    const nextPosition = projectedDrag.nextNodePositionById.get(node.id) ?? null
    const position = nextPosition ?? node.position

    return {
      id: node.id,
      rect: {
        x: position.x,
        y: position.y,
        width: node.data.width,
        height: node.data.height,
      },
    }
  })

  const shouldEnsureSpaceFitsOwnedNodes = Boolean(
    targetSpaceId && reassignedSpaces.find(space => space.id === targetSpaceId)?.rect,
  )

  if (shouldEnsureSpaceFitsOwnedNodes && targetSpaceId) {
    const nodeRectById = new Map(nodeRects.map(item => [item.id, item.rect]))
    const targetSpace = reassignedSpaces.find(space => space.id === targetSpaceId) ?? null
    const targetSpaceRect = targetSpace?.rect ?? null
    const ownedRects =
      targetSpace && targetSpaceRect
        ? targetSpace.nodeIds
            .map(nodeId => nodeRectById.get(nodeId))
            .filter((rect): rect is WorkspaceSpaceRect => Boolean(rect))
        : []

    let minX = Number.POSITIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY

    for (const rect of ownedRects) {
      minX = Math.min(minX, rect.x)
      minY = Math.min(minY, rect.y)
      maxX = Math.max(maxX, rect.x + rect.width)
      maxY = Math.max(maxY, rect.y + rect.height)
    }

    const canComputeExpandedRect =
      Boolean(targetSpaceRect) &&
      ownedRects.length > 0 &&
      Number.isFinite(minX) &&
      Number.isFinite(minY) &&
      Number.isFinite(maxX) &&
      Number.isFinite(maxY)

    const requiredRect: WorkspaceSpaceRect | null = canComputeExpandedRect
      ? {
          x: minX - SPACE_NODE_PADDING,
          y: minY - SPACE_NODE_PADDING,
          width: maxX - minX + SPACE_NODE_PADDING * 2,
          height: maxY - minY + SPACE_NODE_PADDING * 2,
        }
      : null

    const expandedRect: WorkspaceSpaceRect | null =
      requiredRect && targetSpaceRect
        ? (() => {
            const nextLeft = Math.min(targetSpaceRect.x, requiredRect.x)
            const nextTop = Math.min(targetSpaceRect.y, requiredRect.y)
            const nextRight = Math.max(
              targetSpaceRect.x + targetSpaceRect.width,
              requiredRect.x + requiredRect.width,
            )
            const nextBottom = Math.max(
              targetSpaceRect.y + targetSpaceRect.height,
              requiredRect.y + requiredRect.height,
            )

            return {
              x: nextLeft,
              y: nextTop,
              width: Math.max(SPACE_MIN_SIZE.width, nextRight - nextLeft),
              height: Math.max(SPACE_MIN_SIZE.height, nextBottom - nextTop),
            }
          })()
        : null

    const cacheHit = Boolean(
      previousCache &&
        expandedRect &&
        previousCache.baselineSpaces === spaces &&
        previousCache.targetSpaceId === targetSpaceId &&
        previousCache.expandedRect.x === expandedRect.x &&
        previousCache.expandedRect.y === expandedRect.y &&
        previousCache.expandedRect.width === expandedRect.width &&
        previousCache.expandedRect.height === expandedRect.height,
    )

    if (cacheHit && previousCache && expandedRect && targetSpaceRect) {
      const nextSpaces = reassignedSpaces.map(space => {
        if (!space.rect) {
          return space
        }

        const rectOverride = previousCache.nextSpaceRectById.get(space.id) ?? null
        if (!rectOverride) {
          return space
        }

        if (
          rectOverride.x === space.rect.x &&
          rectOverride.y === space.rect.y &&
          rectOverride.width === space.rect.width &&
          rectOverride.height === space.rect.height
        ) {
          return space
        }

        return { ...space, rect: rectOverride }
      })

      nodeRects = nodeRects.map(item => {
        const next = previousCache.movedNodePositionById.get(item.id)
        if (!next) {
          return item
        }

        if (item.rect.x === next.x && item.rect.y === next.y) {
          return item
        }

        return { id: item.id, rect: { ...item.rect, x: next.x, y: next.y } }
      })

      return {
        targetSpaceId,
        nextNodePositionById: new Map(
          nodeRects.map(item => [item.id, { x: item.rect.x, y: item.rect.y }]),
        ),
        nextSpaces,
        hasSpaceChange: true,
        nextCache: previousCache,
      }
    }

    if (
      expandedRect &&
      targetSpaceRect &&
      expandedRect.x === targetSpaceRect.x &&
      expandedRect.y === targetSpaceRect.y &&
      expandedRect.width === targetSpaceRect.width &&
      expandedRect.height === targetSpaceRect.height
    ) {
      return {
        targetSpaceId,
        nextNodePositionById: new Map(
          nodeRects.map(item => [item.id, { x: item.rect.x, y: item.rect.y }]),
        ),
        nextSpaces: hasSpaceChange ? reassignedSpaces : spaces,
        hasSpaceChange,
        nextCache: null,
      }
    }

    const { spaces: pushedSpaces, nodePositionById } = expandSpaceToFitOwnedNodesAndPushAway({
      targetSpaceId,
      spaces: reassignedSpaces,
      nodeRects,
      gap: 0,
    })

    nodeRects = nodeRects.map(item => {
      const next = nodePositionById.get(item.id)
      if (!next) {
        return item
      }

      return { id: item.id, rect: { ...item.rect, x: next.x, y: next.y } }
    })

    return {
      targetSpaceId,
      nextNodePositionById: new Map(
        nodeRects.map(item => [item.id, { x: item.rect.x, y: item.rect.y }]),
      ),
      nextSpaces: pushedSpaces,
      hasSpaceChange: true,
      nextCache:
        expandedRect && targetSpaceRect
          ? {
              baselineSpaces: spaces,
              targetSpaceId,
              expandedRect,
              nextSpaceRectById: new Map(
                pushedSpaces
                  .filter(space => Boolean(space.rect))
                  .map(space => [space.id, space.rect!] as const),
              ),
              movedNodePositionById: nodePositionById,
            }
          : null,
    }
  }

  return {
    targetSpaceId,
    nextNodePositionById: new Map(
      nodeRects.map(item => [item.id, { x: item.rect.x, y: item.rect.y }]),
    ),
    nextSpaces: hasSpaceChange ? reassignedSpaces : spaces,
    hasSpaceChange,
    nextCache: null,
  }
}
