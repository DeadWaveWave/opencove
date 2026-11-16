import type { Node } from '@xyflow/react'
import type { Point, TerminalNodeData } from '../../../types'
import { findNearestFreePositionOnRight } from '../../../utils/collision'
import type { WorkspaceDocument } from '../../../store/workspaceDocument'
import type { NodeCreationPlacementOptions } from '../types'
import type { UseWorkspaceCanvasNodesStoreResult } from './useNodesStore.types'

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
}): void {
  if (creationPlacement.preferredDirection !== 'right' || !creationPlacement.avoidRects?.length) {
    return
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
    return
  }
  setNodes(
    previous =>
      previous.map(node => (node.id === created.id ? { ...node, position: nextPosition } : node)),
    { syncLayout: false },
  )
}
