import type { Node } from '@xyflow/react'
import type { TerminalNodeData, WorkspaceSpaceRect, WorkspaceSpaceState } from '../../../types'
import { expandSpaceToFitOwnedNodesAndPushAway } from '../../../utils/spaceAutoResize'
import { pushAwayLayout, type LayoutDirection } from '../../../utils/spaceLayout'
import { reassignNodesAcrossSpaces } from './useSpaceOwnership.drop.helpers'
import { projectWorkspaceNodeDragLayout } from './useSpaceOwnership.projectLayout'

export interface ProjectedWorkspaceNodeDropLayout {
  targetSpaceId: string | null
  nextNodePositionById: Map<string, { x: number; y: number }>
  nextSpaces: WorkspaceSpaceState[]
  hasSpaceChange: boolean
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

export function projectWorkspaceNodeDropLayout({
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
}): ProjectedWorkspaceNodeDropLayout {
  if (draggedNodeIds.length === 0) {
    return {
      targetSpaceId: null,
      nextNodePositionById: new Map(),
      nextSpaces: spaces,
      hasSpaceChange: false,
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
    }
  }

  const targetSpaceId = projectedDrag.targetSpaceId
  const dragDirections = buildDragDirectionPreference(dragDx, dragDy)

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

  if (targetSpaceId) {
    const targetSpaceNodeIds =
      reassignedSpaces.find(space => space.id === targetSpaceId)?.nodeIds ?? []

    if (targetSpaceNodeIds.length > 1) {
      const rectByNodeId = new Map(nodeRects.map(item => [item.id, item.rect]))
      const reflowItems = targetSpaceNodeIds
        .map(nodeId => {
          const rect = rectByNodeId.get(nodeId)
          if (!rect) {
            return null
          }

          return {
            id: nodeId,
            kind: 'node' as const,
            groupId: nodeId,
            rect: { ...rect },
          }
        })
        .filter(
          (
            item,
          ): item is {
            id: string
            kind: 'node'
            groupId: string
            rect: WorkspaceSpaceRect
          } => Boolean(item),
        )

      if (reflowItems.length > 1) {
        const pushed = pushAwayLayout({
          items: reflowItems,
          pinnedGroupIds: draggedNodeIds,
          sourceGroupIds: draggedNodeIds,
          directions: dragDirections,
          gap: 0,
        })

        const reflowPositionByNodeId = new Map(
          pushed.map(item => [item.id, { x: item.rect.x, y: item.rect.y }]),
        )

        if (reflowPositionByNodeId.size > 0) {
          nodeRects = nodeRects.map(item => {
            const nextPosition = reflowPositionByNodeId.get(item.id)
            if (!nextPosition) {
              return item
            }

            return {
              id: item.id,
              rect: {
                ...item.rect,
                x: nextPosition.x,
                y: nextPosition.y,
              },
            }
          })
        }
      }
    }
  }

  if (shouldEnsureSpaceFitsOwnedNodes && targetSpaceId) {
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
    }
  }

  return {
    targetSpaceId,
    nextNodePositionById: new Map(
      nodeRects.map(item => [item.id, { x: item.rect.x, y: item.rect.y }]),
    ),
    nextSpaces: hasSpaceChange ? reassignedSpaces : spaces,
    hasSpaceChange,
  }
}
