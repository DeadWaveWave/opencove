import type { Node } from '@xyflow/react'
import type { Point, Size, TerminalNodeData, WorkspaceSpaceState } from '../../../types'
import { resolveWorkspaceNodesPlacement } from '@contexts/workspace/domain/workspaceNodePlacement'
import type { NodePlacementDirection } from '../types'
import { useCanvasCollapseStore } from '../../../store/useCanvasCollapseStore'
import { EMPTY_CANVAS_COLLAPSE } from '../../../utils/canvasCollapse'
import { projectCanvasInteractionLayout } from '../../../utils/canvasInteractionLayout'

export function resolveCreationInteractionLayout(
  workspaceId: string | undefined,
  nodes: Node<TerminalNodeData>[],
  spaces: WorkspaceSpaceState[],
) {
  const state =
    (workspaceId && useCanvasCollapseStore.getState().workspaces[workspaceId]) ||
    EMPTY_CANVAS_COLLAPSE
  return projectCanvasInteractionLayout(nodes, spaces, state)
}

export function resolveNodesPlacement({
  anchor,
  size,
  workspaceId,
  getNodes,
  getSpaces,
  getSpaceRects,
  targetSpaceRect,
  preferredDirection,
  avoidRects,
}: {
  anchor: Point
  size: Size
  workspaceId?: string
  getNodes: () => Node<TerminalNodeData>[]
  getSpaces?: () => WorkspaceSpaceState[]
  getSpaceRects?: () => Array<{ x: number; y: number; width: number; height: number }>
  targetSpaceRect?: { x: number; y: number; width: number; height: number } | null
  preferredDirection?: NodePlacementDirection
  avoidRects?: Array<{ x: number; y: number; width: number; height: number }>
}): { placement: Point; canPlace: boolean } {
  const layout = resolveCreationInteractionLayout(workspaceId, getNodes(), getSpaces?.() ?? [])
  return resolveWorkspaceNodesPlacement({
    anchor,
    size,
    nodes: layout.nodes,
    spaceRects: getSpaces
      ? layout.spaces.flatMap(space => (space.rect ? [space.rect] : []))
      : (getSpaceRects?.() ?? []),
    targetSpaceRect,
    preferredDirection,
    avoidRects,
  })
}
