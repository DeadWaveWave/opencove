import type { Node } from '@xyflow/react'
import type { TerminalNodeData, WorkspaceSpaceRect, WorkspaceSpaceState } from '../../../types'
import { expandSpaceToFitOwnedNodesAndPushAway } from '../../../utils/spaceAutoResize'
import { SPACE_NODE_PADDING } from '../../../utils/spaceLayout'
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

function sumRectArea(rects: WorkspaceSpaceRect[]): number {
  let total = 0
  for (const rect of rects) {
    total += rect.width * rect.height
  }
  return total
}

function resolveSpaceEntryReserveRect({
  spaceRect,
  ownedRects,
  padding = SPACE_NODE_PADDING,
  targetFill = 0.6,
  maxScale = 2.25,
}: {
  spaceRect: WorkspaceSpaceRect
  ownedRects: WorkspaceSpaceRect[]
  padding?: number
  targetFill?: number
  maxScale?: number
}): WorkspaceSpaceRect | null {
  if (ownedRects.length === 0) {
    return null
  }

  const usableWidth = Math.max(0, spaceRect.width - padding * 2)
  const usableHeight = Math.max(0, spaceRect.height - padding * 2)
  const usableArea = usableWidth * usableHeight
  if (usableArea <= 0) {
    return null
  }

  const totalArea = sumRectArea(ownedRects)
  const density = totalArea / usableArea

  if (!Number.isFinite(density) || density <= targetFill) {
    return null
  }

  const requiredArea = totalArea / targetFill
  const scale = Math.min(maxScale, Math.sqrt(requiredArea / usableArea))

  if (!Number.isFinite(scale) || scale <= 1) {
    return null
  }

  const nextUsableWidth = usableWidth * scale
  const nextUsableHeight = usableHeight * scale

  return {
    x: spaceRect.x,
    y: spaceRect.y,
    width: Math.max(spaceRect.width, nextUsableWidth + padding * 2),
    height: Math.max(spaceRect.height, nextUsableHeight + padding * 2),
  }
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

    const targetSpace = reassignedSpaces.find(space => space.id === targetSpaceId) ?? null
    const ownedRectById = new Map(nodeRects.map(item => [item.id, item.rect]))
    const ownedRects =
      targetSpace?.rect && targetSpace.nodeIds.length > 0
        ? targetSpace.nodeIds
            .map(nodeId => ownedRectById.get(nodeId))
            .filter((rect): rect is WorkspaceSpaceRect => Boolean(rect))
        : []

    const minimumRect =
      targetSpace?.rect && hasSpaceChange
        ? resolveSpaceEntryReserveRect({ spaceRect: targetSpace.rect, ownedRects })
        : null

    const { spaces: pushedSpaces, nodePositionById } = expandSpaceToFitOwnedNodesAndPushAway({
      targetSpaceId,
      spaces: reassignedSpaces,
      nodeRects,
      gap: 0,
      minimumRect,
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
      const stableSpaces = hasSpaceChange ? reassignedSpaces : effectiveSpaces
      const stableSpaceRectById = new Map(
        stableSpaces
          .filter(space => Boolean(space.rect))
          .map(space => [space.id, space.rect!] as const),
      )
      const stableTargetRect = stableSpaceRectById.get(targetSpaceId) ?? targetSpace?.rect ?? null

      return {
        targetSpaceId,
        nextNodePositionById: new Map(
          nodeRects.map(item => [item.id, { x: item.rect.x, y: item.rect.y }]),
        ),
        nextSpaces: stableSpaces,
        hasSpaceChange,
        nextCache: stableTargetRect
          ? {
              baselineSpaces: spaces,
              targetSpaceId,
              expandedRect: stableTargetRect,
              nextSpaceRectById: stableSpaceRectById,
              movedNodePositionById: nodePositionById,
            }
          : null,
      }
    }

    const expandedRect = pushedSpaces.find(space => space.id === targetSpaceId)?.rect ?? null
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
    nextSpaces: hasSpaceChange ? reassignedSpaces : effectiveSpaces,
    hasSpaceChange,
    nextCache: null,
  }
}
