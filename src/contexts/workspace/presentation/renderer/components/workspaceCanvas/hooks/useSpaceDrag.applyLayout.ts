import type { Node } from '@xyflow/react'
import type { TerminalNodeData, WorkspaceSpaceRect } from '../../../types'
import type { WorkspaceDocument } from '../../../store/workspaceDocument'
import type { CanvasInteractionCommands } from '../../../store/canvasStore.interaction'
import { toLiveNodes } from '../../../utils/canvasLiveNodes'
import type { SpaceDragState } from '../types'
import { projectWorkspaceSpaceDragLayout } from './useSpaceDrag.finalize'
import { resolveResizedSpaceRect } from './useSpaceDrag.preview'

/** The nodes with the projected positions applied; a node the projection leaves where it is stays itself. */
function applyProjectedNodePositions(
  nodes: Node<TerminalNodeData>[],
  positionById: ReadonlyMap<string, { x: number; y: number }>,
): Node<TerminalNodeData>[] {
  return nodes.map(node => {
    const nextPosition = positionById.get(node.id)
    if (
      !nextPosition ||
      (node.position.x === nextPosition.x && node.position.y === nextPosition.y)
    ) {
      return node
    }

    return { ...node, position: nextPosition }
  })
}

/**
 * One frame of a Space drag. It reads the committed document once and publishes to the
 * `interaction` slice only: the windows the drag owns (the overlay, by the rule of the node drag:
 * `toLiveNodes` against the drag-start positions and the committed ones) and the Space frames.
 * The document is written once, at the release (`finalizeWorkspaceSpaceDrag`).
 */
export function applyProjectedWorkspaceSpaceDragLayout({
  dragState,
  dx,
  dy,
  readDocument,
  publishLiveNodes,
  setSpaceDragFramePreview,
}: {
  dragState: SpaceDragState
  dx: number
  dy: number
  readDocument: () => WorkspaceDocument
  publishLiveNodes: CanvasInteractionCommands['publishLiveNodes']
  setSpaceDragFramePreview: CanvasInteractionCommands['setSpaceDragFramePreview']
}): void {
  const { nodes, spaces } = readDocument()
  const projected = projectWorkspaceSpaceDragLayout({
    dragState,
    dx,
    dy,
    nodes,
    spaces,
    resolveResizedRect: resolveResizedSpaceRect,
  })

  setSpaceDragFramePreview(
    new Map<string, WorkspaceSpaceRect>(
      projected.nextSpaces
        .filter(space => space.rect)
        .map(space => [space.id, space.rect!] as const),
    ),
  )
  publishLiveNodes(
    toLiveNodes(
      applyProjectedNodePositions(nodes, projected.nextNodePositionById),
      dragState.allNodePositions,
      nodes,
    ),
  )
}
