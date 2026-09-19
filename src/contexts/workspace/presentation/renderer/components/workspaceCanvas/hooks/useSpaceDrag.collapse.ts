import type { Node } from '@xyflow/react'
import type { TerminalNodeData, WorkspaceSpaceRect, WorkspaceSpaceState } from '../../../types'
import {
  projectCanvasInteractionLayout,
  restoreCanvasInteractionLayout,
} from '../../../utils/canvasInteractionLayout'
import type { SpaceDragState } from '../types'

export interface SpaceDragLayoutInput {
  dragState: SpaceDragState
  dx: number
  dy: number
  nodes: Node<TerminalNodeData>[]
  spaces: WorkspaceSpaceState[]
  resolveResizedRect: (state: SpaceDragState, dx: number, dy: number) => WorkspaceSpaceRect
}

/** Display geometry enters the layout algorithm; only canonical positions leave it. */
export function projectSpaceDragWithCollapse<
  T extends {
    nextSpaces: WorkspaceSpaceState[]
    nextNodePositionById: Map<string, { x: number; y: number }>
  },
>(input: SpaceDragLayoutInput, project: (input: SpaceDragLayoutInput) => T | null): T | null {
  const state = input.dragState.collapseState
  if (!state) {
    return project(input)
  }
  const baselineNodes = input.nodes.map(node => {
    const position = input.dragState.allNodePositions.get(node.id)
    return position ? { ...node, position } : node
  })
  const displayed = projectCanvasInteractionLayout(baselineNodes, input.spaces, state)
  const displayedRect = displayed.spaces.find(space => space.id === input.dragState.spaceId)?.rect
  const projected = project({
    ...input,
    ...displayed,
    dragState: {
      ...input.dragState,
      initialRect: displayedRect ?? input.dragState.initialRect,
    },
  })
  return projected
    ? restoreCanvasInteractionLayout(projected, baselineNodes, input.spaces, state)
    : null
}
