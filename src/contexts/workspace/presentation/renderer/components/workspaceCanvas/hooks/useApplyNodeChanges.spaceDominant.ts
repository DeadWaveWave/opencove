import type { Node } from '@xyflow/react'
import type { TerminalNodeData, WorkspaceSpaceRect, WorkspaceSpaceState } from '../../../types'
import type { LayoutDirection } from '../../../utils/spaceLayout'
import { projectWorkspacePushAwayLayout } from '../../../utils/workspacePushAwayProjection'

export interface ProjectedWorkspaceSpaceDominantLayout {
  nextNodePositionById: Map<string, { x: number; y: number }>
  nextSpaceFramePreview: ReadonlyMap<string, WorkspaceSpaceRect>
}

export function projectWorkspaceSpaceDominantLayout({
  nodes,
  spaces,
  baselineNodePositionById,
  baselineSpaceRectById,
  desiredDraggedPositionById,
  draggedNodeIds,
  selectedSpaceIds,
  dragDx,
  dragDy,
}: {
  nodes: Node<TerminalNodeData>[]
  spaces: WorkspaceSpaceState[]
  baselineNodePositionById: Map<string, { x: number; y: number }>
  baselineSpaceRectById: Map<string, WorkspaceSpaceRect>
  desiredDraggedPositionById: Map<string, { x: number; y: number }>
  draggedNodeIds: string[]
  selectedSpaceIds: string[]
  dragDx: number
  dragDy: number
}): ProjectedWorkspaceSpaceDominantLayout {
  const selectedSpaceIdSet = new Set(selectedSpaceIds)
  const draggedNodeIdSet = new Set(draggedNodeIds)
  const ownedNodeIdsToShift = new Set<string>()

  for (const space of spaces) {
    if (!selectedSpaceIdSet.has(space.id) || !space.rect) {
      continue
    }

    for (const nodeId of space.nodeIds) {
      if (draggedNodeIdSet.has(nodeId)) {
        continue
      }

      ownedNodeIdsToShift.add(nodeId)
    }
  }

  const draftSpaces = spaces.map(space => {
    const baselineRect = baselineSpaceRectById.get(space.id) ?? space.rect
    if (!baselineRect) {
      return space
    }

    const nextRect = selectedSpaceIdSet.has(space.id)
      ? {
          ...baselineRect,
          x: baselineRect.x + dragDx,
          y: baselineRect.y + dragDy,
        }
      : { ...baselineRect }

    return {
      ...space,
      rect: nextRect,
    }
  })

  const draftNodes = nodes.map(node => {
    const baseline = baselineNodePositionById.get(node.id) ?? node.position
    const desiredPosition = desiredDraggedPositionById.get(node.id) ?? null
    const nextPosition =
      desiredPosition ??
      (ownedNodeIdsToShift.has(node.id)
        ? { x: baseline.x + dragDx, y: baseline.y + dragDy }
        : baseline)

    if (node.position.x === nextPosition.x && node.position.y === nextPosition.y) {
      return node
    }

    return { ...node, position: nextPosition }
  })

  const projected = projectWorkspacePushAwayLayout({
    spaces: draftSpaces,
    nodes: draftNodes,
    pinnedGroupIds: selectedSpaceIds,
    sourceGroupIds: selectedSpaceIds,
    directions: resolveMoveDirections(dragDx, dragDy),
    gap: 0,
  })

  return {
    nextNodePositionById: projected.nextNodePositionById,
    nextSpaceFramePreview: new Map(
      projected.nextSpaces
        .filter(space => Boolean(space.rect))
        .map(space => [space.id, space.rect!] as const),
    ),
  }
}

function resolveMoveDirections(dx: number, dy: number): LayoutDirection[] {
  const ordered: LayoutDirection[] = []
  const xDirection = dx >= 0 ? ('x+' as const) : ('x-' as const)
  const yDirection = dy >= 0 ? ('y+' as const) : ('y-' as const)

  if (Math.abs(dx) >= Math.abs(dy)) {
    ordered.push(xDirection, yDirection)
  } else {
    ordered.push(yDirection, xDirection)
  }

  if (!ordered.includes('y+')) {
    ordered.push('y+')
  }
  if (!ordered.includes('y-')) {
    ordered.push('y-')
  }
  if (!ordered.includes('x+')) {
    ordered.push('x+')
  }
  if (!ordered.includes('x-')) {
    ordered.push('x-')
  }

  return ordered
}
