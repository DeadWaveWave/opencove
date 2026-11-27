import type { Node } from '@xyflow/react'
import type { Point, TerminalNodeData } from '../../../types'
import { findNearestFreePositionOnRight } from '../../../utils/collision'
import type { WorkspaceDocument } from '../../../store/workspaceDocument'
import type { NodeCreationPlacementOptions } from '../types'
import type { UseWorkspaceCanvasNodesStoreResult } from './useNodesStore.types'

/**
 * Moves a just-created explorer node to the nearest free spot to the right of its anchor when
 * the placement asks for it, and returns the node as stored after the move (or the created node
 * itself when it did not move), so a caller reports the position the node occupies. The Space
 * assignment that follows takes the node from the document and does not need it (#725, #758).
 */
export function repositionCreatedExplorerNode({
  created,
  creationAnchor,
  creationPlacement,
  readDocument,
  setNodes,
}: {
  created: Node<TerminalNodeData>
  creationAnchor: Point
  creationPlacement: NodeCreationPlacementOptions
  readDocument: () => WorkspaceDocument
  setNodes: UseWorkspaceCanvasNodesStoreResult['setNodes']
}): Node<TerminalNodeData> {
  if (creationPlacement.preferredDirection !== 'right' || !creationPlacement.avoidRects?.length) {
    return created
  }
  const nextPosition = findNearestFreePositionOnRight(
    creationAnchor,
    created.data,
    readDocument().nodes,
    created.id,
    creationPlacement.avoidRects.map(rect => ({
      left: rect.x,
      top: rect.y,
      right: rect.x + rect.width,
      bottom: rect.y + rect.height,
    })),
  )
  if (
    !nextPosition ||
    (nextPosition.x === created.position.x && nextPosition.y === created.position.y)
  ) {
    return created
  }
  setNodes(
    previous =>
      previous.map(node => (node.id === created.id ? { ...node, position: nextPosition } : node)),
    { syncLayout: false },
  )
  return { ...created, position: nextPosition }
}
