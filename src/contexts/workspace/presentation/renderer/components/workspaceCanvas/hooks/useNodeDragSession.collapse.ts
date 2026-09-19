import { useCanvasCollapseStore } from '../../../store/useCanvasCollapseStore'
import { EMPTY_CANVAS_COLLAPSE } from '../../../utils/canvasCollapse'
import type { Node } from '@xyflow/react'
import type { Point, TerminalNodeData, WorkspaceSpaceState } from '../../../types'
import { resolveWorkspaceSnap } from '../../../utils/workspaceSnap'
import {
  resolveWorkspaceNodeSnapCandidateRects,
  unionWorkspaceNodeRects,
} from '../../../utils/workspaceSnap.nodes'
import { WORKSPACE_ARRANGE_GRID_PX } from '../../../utils/workspaceArrange.shared'
import {
  projectCanvasInteractionLayout,
  restoreCanvasInteractionLayout,
} from '../../../utils/canvasInteractionLayout'
import {
  projectWorkspaceNodeDropLayout,
  projectWorkspaceNodeLiveDropLayout,
  projectWorkspaceNodePrimaryDropLayout,
} from './useSpaceOwnership.projectDropLayout'

export function readCanvasInteractionState(workspaceId?: string) {
  return (
    (workspaceId && useCanvasCollapseStore.getState().workspaces[workspaceId]) ||
    EMPTY_CANVAS_COLLAPSE
  )
}

export function projectCanvasInteractionDrop(
  input: Parameters<typeof projectWorkspaceNodeDropLayout>[0],
  workspaceId: string | undefined,
  strategy: 'primary' | 'live' | 'final' = 'final',
) {
  const state = readCanvasInteractionState(workspaceId)
  const layout = projectCanvasInteractionLayout(input.nodes, input.spaces, state)
  const project =
    strategy === 'primary'
      ? projectWorkspaceNodePrimaryDropLayout
      : strategy === 'live'
        ? projectWorkspaceNodeLiveDropLayout
        : projectWorkspaceNodeDropLayout
  const result = project({ ...input, ...layout })
  return restoreCanvasInteractionLayout(result, input.nodes, input.spaces, state)
}

export function resolveSnappedCanvasDropPositions({
  nodes,
  fallbackNodes,
  spaces,
  workspaceId,
  draggedNodeIds,
  draggedNodePositionById,
}: {
  nodes: Node<TerminalNodeData>[]
  fallbackNodes: Node<TerminalNodeData>[]
  spaces: WorkspaceSpaceState[]
  workspaceId?: string
  draggedNodeIds: string[]
  draggedNodePositionById: Map<string, Point>
}): Map<string, Point> {
  if (!draggedNodeIds.length) {
    return draggedNodePositionById
  }
  const ids = new Set(nodes.map(node => node.id))
  const allNodes = [...nodes, ...fallbackNodes.filter(node => !ids.has(node.id))]
  const interaction = projectCanvasInteractionLayout(
    allNodes,
    spaces,
    readCanvasInteractionState(workspaceId),
  )
  const currentNodes = interaction.nodes.map(node => {
    const position = draggedNodePositionById.get(node.id)
    return position ? { ...node, position } : node
  })
  const movingNodeIds = new Set(draggedNodeIds)
  const movingRect = unionWorkspaceNodeRects(
    currentNodes.filter(node => movingNodeIds.has(node.id)),
  )
  if (!movingRect) {
    return draggedNodePositionById
  }
  const snapped = resolveWorkspaceSnap({
    movingRect,
    candidateRects: resolveWorkspaceNodeSnapCandidateRects({
      movingNodeIds,
      nodes: currentNodes,
      spaces: interaction.spaces,
    }),
    grid: WORKSPACE_ARRANGE_GRID_PX,
    threshold: 8,
    enableGrid: true,
    enableObject: true,
  })
  if (!snapped.dx && !snapped.dy) {
    return draggedNodePositionById
  }
  const result = new Map<string, Point>()
  for (const id of draggedNodeIds) {
    const position =
      draggedNodePositionById.get(id) ?? currentNodes.find(node => node.id === id)?.position
    if (position) {
      result.set(id, { x: position.x + snapped.dx, y: position.y + snapped.dy })
    }
  }
  return result.size ? result : draggedNodePositionById
}
