import type { Node } from '@xyflow/react'
import type { TerminalNodeData, WorkspaceSpaceRect, WorkspaceSpaceState } from '../../../types'
import type { LayoutDirection } from '../../../utils/spaceLayout'
import { projectWorkspacePushAwayLayout } from '../../../utils/workspacePushAwayProjection'

export interface ProjectedChildSpaceMoveLayout {
  nextSpaces: WorkspaceSpaceState[]
  nextNodePositionById: Map<string, { x: number; y: number }>
}

export function projectChildSpaceMoveWithinParent({
  targetSpaceId,
  parentSpaceId,
  draftSpaces,
  previousSpaces,
  draftNodes,
  movedSpaceIds,
  owningSpaceIdByNodeId,
  draggedNodeIds,
  directions,
  childSpaceDragPadding,
}: {
  targetSpaceId: string
  parentSpaceId: string
  draftSpaces: WorkspaceSpaceState[]
  previousSpaces: WorkspaceSpaceState[]
  draftNodes: Node<TerminalNodeData>[]
  movedSpaceIds: Set<string>
  owningSpaceIdByNodeId: Map<string, string>
  draggedNodeIds: Set<string>
  directions: LayoutDirection[]
  childSpaceDragPadding: number
}): ProjectedChildSpaceMoveLayout {
  const directChildSpaceIds = new Set(
    previousSpaces
      .filter(space => (space.parentSpaceId ?? null) === parentSpaceId)
      .map(space => space.id),
  )
  const scopedNodeIds = new Set<string>()

  for (const space of previousSpaces) {
    if (space.id !== parentSpaceId && !directChildSpaceIds.has(space.id)) {
      continue
    }

    for (const nodeId of space.nodeIds) {
      scopedNodeIds.add(nodeId)
    }
  }

  const scopedSpaces = draftSpaces.filter(space => directChildSpaceIds.has(space.id))
  const scopedNodes = draftNodes.filter(node => scopedNodeIds.has(node.id))
  const parentRect = previousSpaces.find(space => space.id === parentSpaceId)?.rect ?? null
  const projected = projectWorkspacePushAwayLayout({
    spaces: scopedSpaces,
    nodes: scopedNodes,
    pinnedGroupIds: [targetSpaceId],
    sourceGroupIds: [targetSpaceId],
    directions,
    gap: 0,
    bounds: parentRect ? { rect: parentRect, padding: childSpaceDragPadding } : undefined,
  })
  const projectedSpaceById = new Map(projected.nextSpaces.map(space => [space.id, space] as const))
  const nextNodePositionById = new Map<string, { x: number; y: number }>()

  for (const node of draftNodes) {
    const ownerSpaceId = owningSpaceIdByNodeId.get(node.id) ?? null
    if (!draggedNodeIds.has(node.id) && (!ownerSpaceId || !movedSpaceIds.has(ownerSpaceId))) {
      continue
    }

    nextNodePositionById.set(node.id, { x: node.position.x, y: node.position.y })
  }

  for (const [nodeId, position] of projected.nextNodePositionById.entries()) {
    nextNodePositionById.set(nodeId, position)
  }

  const nextSpaces = draftSpaces.map(space => {
    const projectedSpace = projectedSpaceById.get(space.id) ?? null
    if (!projectedSpace?.rect || !space.rect) {
      return space
    }

    return rectEquals(projectedSpace.rect, space.rect)
      ? space
      : { ...space, rect: projectedSpace.rect }
  })

  return {
    nextSpaces,
    nextNodePositionById,
  }
}

function rectEquals(a: WorkspaceSpaceRect, b: WorkspaceSpaceRect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}
