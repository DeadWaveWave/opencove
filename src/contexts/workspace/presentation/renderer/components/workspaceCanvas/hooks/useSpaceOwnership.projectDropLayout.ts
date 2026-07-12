import type { Node } from '@xyflow/react'
import type { TerminalNodeData, WorkspaceSpaceRect, WorkspaceSpaceState } from '../../../types'
import { expandSpaceToFitOwnedNodesAndPushAway } from '../../../utils/spaceAutoResize'
import { reassignNodesAcrossSpaces } from './useSpaceOwnership.drop.helpers'
import {
  projectWorkspaceNodeDragLayout,
  projectWorkspaceNodeLiveDragLayout,
  type ProjectedNodeDragLayout,
} from './useSpaceOwnership.projectLayout'
import { projectWorkspaceNodePrimaryDragLayout } from './useSpaceOwnership.projectLayout.primary'

export interface ProjectedWorkspaceNodeDropLayout {
  targetSpaceId: string | null
  nextNodePositionById: Map<string, { x: number; y: number }>
  nextSpaces: WorkspaceSpaceState[]
  hasSpaceChange: boolean
}

interface ProjectWorkspaceNodeDropLayoutInput {
  nodes: Node<TerminalNodeData>[]
  spaces: WorkspaceSpaceState[]
  draggedNodeIds: string[]
  draggedNodePositionById: Map<string, { x: number; y: number }>
  dragDx?: number
  dragDy?: number
  dropFlowPoint?: { x: number; y: number } | null
}

type DragProjector = (input: ProjectWorkspaceNodeDropLayoutInput) => ProjectedNodeDragLayout | null

function rectEquals(a: WorkspaceSpaceRect | null, b: WorkspaceSpaceRect | null): boolean {
  if (a === b) {
    return true
  }

  if (!a || !b) {
    return false
  }

  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}

function mergeProjectedSpaceRects({
  spaces,
  projectedSpaces,
}: {
  spaces: WorkspaceSpaceState[]
  projectedSpaces: WorkspaceSpaceState[]
}): WorkspaceSpaceState[] {
  const projectedSpaceById = new Map(projectedSpaces.map(space => [space.id, space]))
  return spaces.map(space => {
    const projectedRect = projectedSpaceById.get(space.id)?.rect ?? null
    return projectedRect && !rectEquals(projectedRect, space.rect)
      ? { ...space, rect: { ...projectedRect } }
      : space
  })
}

function projectWorkspaceNodeDropLayoutWith({
  input,
  projectDrag,
  previewOnly = false,
  preserveDraggedNodePositions = false,
}: {
  input: ProjectWorkspaceNodeDropLayoutInput
  projectDrag: DragProjector
  previewOnly?: boolean
  preserveDraggedNodePositions?: boolean
}): ProjectedWorkspaceNodeDropLayout {
  const {
    nodes,
    spaces,
    draggedNodeIds,
    draggedNodePositionById,
    dragDx = 0,
    dragDy = 0,
    dropFlowPoint,
  } = input

  if (draggedNodeIds.length === 0) {
    return {
      targetSpaceId: null,
      nextNodePositionById: new Map(),
      nextSpaces: spaces,
      hasSpaceChange: false,
    }
  }

  const projectedDrag = projectDrag({
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
    const { spaces: pushedSpaces, nodePositionById } = expandSpaceToFitOwnedNodesAndPushAway({
      targetSpaceId,
      spaces: reassignedSpaces,
      nodeRects,
      gap: 0,
    })

    const draggedNodeIdSet = new Set(draggedNodeIds)
    nodeRects = nodeRects.map(item => {
      if (preserveDraggedNodePositions && draggedNodeIdSet.has(item.id)) {
        const primaryPosition = projectedDrag.nextNodePositionById.get(item.id)
        if (primaryPosition) {
          return {
            id: item.id,
            rect: { ...item.rect, x: primaryPosition.x, y: primaryPosition.y },
          }
        }
      }

      const next = nodePositionById.get(item.id)
      return next ? { id: item.id, rect: { ...item.rect, x: next.x, y: next.y } } : item
    })

    const beforeRectById = new Map(
      reassignedSpaces
        .filter(space => Boolean(space.rect))
        .map(space => [space.id, space.rect!] as const),
    )
    const hasRectChange = pushedSpaces.some(
      space => Boolean(space.rect) && !rectEquals(space.rect, beforeRectById.get(space.id) ?? null),
    )

    const projectedSpaces = hasRectChange
      ? pushedSpaces
      : hasSpaceChange
        ? reassignedSpaces
        : spaces
    const nextSpaces = previewOnly
      ? hasRectChange
        ? mergeProjectedSpaceRects({ spaces, projectedSpaces })
        : spaces
      : projectedSpaces

    return {
      targetSpaceId,
      nextNodePositionById: new Map(
        nodeRects.map(item => [item.id, { x: item.rect.x, y: item.rect.y }]),
      ),
      nextSpaces,
      hasSpaceChange: hasRectChange || (!previewOnly && hasSpaceChange),
    }
  }

  return {
    targetSpaceId,
    nextNodePositionById: new Map(
      nodeRects.map(item => [item.id, { x: item.rect.x, y: item.rect.y }]),
    ),
    nextSpaces: previewOnly ? spaces : hasSpaceChange ? reassignedSpaces : spaces,
    hasSpaceChange: previewOnly ? false : hasSpaceChange,
  }
}

export function projectWorkspaceNodeLiveDropLayout(
  input: ProjectWorkspaceNodeDropLayoutInput,
): ProjectedWorkspaceNodeDropLayout {
  return projectWorkspaceNodeDropLayoutWith({
    input,
    projectDrag: projectWorkspaceNodeLiveDragLayout,
    previewOnly: true,
    preserveDraggedNodePositions: true,
  })
}

export function projectWorkspaceNodePrimaryDropLayout(
  input: ProjectWorkspaceNodeDropLayoutInput,
): ProjectedWorkspaceNodeDropLayout {
  return projectWorkspaceNodeTransientDropLayout(
    input,
    projectWorkspaceNodePrimaryDragLayout(input),
    false,
  )
}

function projectWorkspaceNodeTransientDropLayout(
  input: ProjectWorkspaceNodeDropLayoutInput,
  projected: Pick<ProjectedNodeDragLayout, 'targetSpaceId' | 'nextNodePositionById'> | null,
  restoreBaselinePositions: boolean,
): ProjectedWorkspaceNodeDropLayout {
  if (input.draggedNodeIds.length === 0) {
    return {
      targetSpaceId: null,
      nextNodePositionById: new Map(),
      nextSpaces: input.spaces,
      hasSpaceChange: false,
    }
  }

  const nextNodePositionById = restoreBaselinePositions
    ? new Map(input.nodes.map(node => [node.id, { ...node.position }]))
    : new Map<string, { x: number; y: number }>()

  if (projected) {
    projected.nextNodePositionById.forEach((position, nodeId) => {
      nextNodePositionById.set(nodeId, position)
    })
  } else {
    input.draggedNodeIds.forEach(nodeId => {
      const position = input.draggedNodePositionById.get(nodeId)
      if (position) {
        nextNodePositionById.set(nodeId, position)
      }
    })
  }

  return {
    targetSpaceId: projected?.targetSpaceId ?? null,
    nextNodePositionById,
    nextSpaces: input.spaces,
    hasSpaceChange: false,
  }
}

export function projectWorkspaceNodeDropLayout(
  input: ProjectWorkspaceNodeDropLayoutInput,
): ProjectedWorkspaceNodeDropLayout {
  return projectWorkspaceNodeDropLayoutWith({ input, projectDrag: projectWorkspaceNodeDragLayout })
}
