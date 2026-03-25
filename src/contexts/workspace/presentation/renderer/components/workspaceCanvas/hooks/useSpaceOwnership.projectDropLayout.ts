import type { Node } from '@xyflow/react'
import type { TerminalNodeData, WorkspaceSpaceRect, WorkspaceSpaceState } from '../../../types'
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

function rectEquals(a: WorkspaceSpaceRect | null, b: WorkspaceSpaceRect | null): boolean {
  if (a === b) {
    return true
  }

  if (!a || !b) {
    return false
  }

  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}

function applySpaceRectOverrides({
  spaces,
  rectOverrideById,
}: {
  spaces: WorkspaceSpaceState[]
  rectOverrideById: ReadonlyMap<string, WorkspaceSpaceRect>
}): WorkspaceSpaceState[] {
  return spaces.map(space => {
    const override = rectOverrideById.get(space.id) ?? null
    if (!override) {
      return space
    }

    if (rectEquals(space.rect ?? null, override)) {
      return space
    }

    return {
      ...space,
      rect: { ...override },
    }
  })
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

  const canUsePreviousSpaceRects = Boolean(previousCache && previousCache.baselineSpaces === spaces)
  const projectedSpaces = canUsePreviousSpaceRects
    ? applySpaceRectOverrides({
        spaces,
        rectOverrideById: previousCache!.nextSpaceRectById,
      })
    : spaces

  let projectedDrag = projectWorkspaceNodeDragLayout({
    nodes,
    spaces: projectedSpaces,
    draggedNodeIds,
    draggedNodePositionById,
    dragDx,
    dragDy,
    dropFlowPoint,
  })

  const mustDropPreviousCache =
    Boolean(projectedDrag) &&
    Boolean(previousCache) &&
    Boolean(canUsePreviousSpaceRects) &&
    projectedDrag!.targetSpaceId !== previousCache!.targetSpaceId

  if (mustDropPreviousCache) {
    projectedDrag = projectWorkspaceNodeDragLayout({
      nodes,
      spaces,
      draggedNodeIds,
      draggedNodePositionById,
      dragDx,
      dragDy,
      dropFlowPoint,
    })
    previousCache = null
  }

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
  const effectiveSpaces = canUsePreviousSpaceRects && previousCache ? projectedSpaces : spaces

  const { nextSpaces: reassignedSpaces, hasSpaceChange } = reassignNodesAcrossSpaces({
    spaces: effectiveSpaces,
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
    const lockActive = Boolean(
      previousCache &&
      canUsePreviousSpaceRects &&
      previousCache.baselineSpaces === spaces &&
      previousCache.targetSpaceId === targetSpaceId,
    )

    if (lockActive && previousCache) {
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
        nextSpaces: reassignedSpaces,
        hasSpaceChange: true,
        nextCache: previousCache,
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

    const beforeRectById = new Map(
      reassignedSpaces
        .filter(space => Boolean(space.rect))
        .map(space => [space.id, space.rect!] as const),
    )

    const hasRectChange = pushedSpaces.some(space => {
      if (!space.rect) {
        return false
      }

      return !rectEquals(space.rect, beforeRectById.get(space.id) ?? null)
    })

    if (!hasRectChange) {
      return {
        targetSpaceId,
        nextNodePositionById: new Map(
          nodeRects.map(item => [item.id, { x: item.rect.x, y: item.rect.y }]),
        ),
        nextSpaces: hasSpaceChange ? reassignedSpaces : effectiveSpaces,
        hasSpaceChange,
        nextCache: null,
      }
    }

    const expandedRect = pushedSpaces.find(space => space.id === targetSpaceId)?.rect ?? null
    const targetSpaceNodeIdSet = new Set(
      reassignedSpaces.find(space => space.id === targetSpaceId)?.nodeIds ?? [],
    )
    const cachedMovedNodePositionById = new Map<string, { x: number; y: number }>()
    nodePositionById.forEach((position, nodeId) => {
      if (targetSpaceNodeIdSet.has(nodeId)) {
        return
      }

      cachedMovedNodePositionById.set(nodeId, position)
    })
    return {
      targetSpaceId,
      nextNodePositionById: new Map(
        nodeRects.map(item => [item.id, { x: item.rect.x, y: item.rect.y }]),
      ),
      nextSpaces: pushedSpaces,
      hasSpaceChange: true,
      nextCache: expandedRect
        ? {
            baselineSpaces: spaces,
            targetSpaceId,
            expandedRect,
            nextSpaceRectById: new Map(
              pushedSpaces
                .filter(space => Boolean(space.rect))
                .map(space => [space.id, space.rect!] as const),
            ),
            movedNodePositionById: cachedMovedNodePositionById,
          }
        : null,
    }
  }

  return {
    targetSpaceId,
    nextNodePositionById: new Map(
      nodeRects.map(item => [item.id, { x: item.rect.x, y: item.rect.y }]),
    ),
    nextSpaces: hasSpaceChange ? reassignedSpaces : effectiveSpaces,
    hasSpaceChange,
    nextCache: null,
  }
}
