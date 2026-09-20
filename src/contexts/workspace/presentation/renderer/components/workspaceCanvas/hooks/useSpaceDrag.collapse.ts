import type { Node } from '@xyflow/react'
import type { TerminalNodeData, WorkspaceSpaceRect, WorkspaceSpaceState } from '../../../types'
import {
  projectCanvasInteractionLayout,
  restoreCanvasInteractionLayout,
} from '../../../utils/canvasInteractionLayout'
import { collectSpaceDescendantIds, collectSpaceNodeIds } from '../../../utils/canvasCollapse'
import {
  SPACE_FRAME_MIN_WIDTH,
  SPACE_MIN_SIZE,
  SPACE_NODE_PADDING,
} from '../../../utils/spaceLayout'
import type { SpaceDragState } from '../types'
import { resolveSpaceOwnedBounds } from './useSpaceDrag.startState'

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
  const displayedSpace = displayed.spaces.find(space => space.id === input.dragState.spaceId)
  const ownedIds = collectSpaceNodeIds(input.dragState.spaceId, input.spaces)
  const descendantIds = collectSpaceDescendantIds(input.dragState.spaceId, input.spaces)
  const containsCompactContent =
    baselineNodes.some(
      node =>
        ownedIds.has(node.id) &&
        (state.collapsedNodeIds[node.id] || node.data.collapsePresentation?.collapsed),
    ) || [...descendantIds].some(id => state.collapsedSpaceIds[id])
  const projected = project({
    ...input,
    ...displayed,
    dragState: {
      ...input.dragState,
      initialRect: displayedSpace?.rect ?? input.dragState.initialRect,
      ...(input.dragState.handle.kind === 'resize' && displayedSpace
        ? {
            // Both preview and commit constrain the same geometry used by collision layout.
            ownedBounds: resolveSpaceOwnedBounds({
              nodeIds: displayedSpace.nodeIds,
              ...displayed,
              spaceId: displayedSpace.id,
            }),
            minimumSize: containsCompactContent
              ? { width: SPACE_FRAME_MIN_WIDTH, height: SPACE_NODE_PADDING * 2 }
              : SPACE_MIN_SIZE,
          }
        : {}),
    },
  })
  return projected
    ? restoreCanvasInteractionLayout(projected, baselineNodes, input.spaces, state)
    : null
}
