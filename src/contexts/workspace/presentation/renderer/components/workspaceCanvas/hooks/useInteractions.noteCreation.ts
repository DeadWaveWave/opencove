import type { MutableRefObject } from 'react'
import type { Node } from '@xyflow/react'
import type { Point, TerminalNodeData, WorkspaceSpaceState } from '../../../types'
import {
  assignNodeToSpaceAndExpand,
  findContainingSpaceByAnchor,
} from './useInteractions.spaceAssignment'

type SetNodes = (
  updater: (prevNodes: Node<TerminalNodeData>[]) => Node<TerminalNodeData>[],
  options?: { syncLayout?: boolean },
) => void

export function createNoteNodeAtAnchor({
  anchor,
  spaceAnchor = anchor,
  createNoteNode,
  spacesRef,
  nodesRef,
  setNodes,
  onSpacesChange,
}: {
  anchor: Point
  spaceAnchor?: Point
  createNoteNode: (anchor: Point) => Node<TerminalNodeData> | null
  spacesRef: MutableRefObject<WorkspaceSpaceState[]>
  nodesRef: MutableRefObject<Node<TerminalNodeData>[]>
  setNodes: SetNodes
  onSpacesChange: (spaces: WorkspaceSpaceState[]) => void
}): void {
  const created = createNoteNode(anchor)
  if (!created) {
    return
  }

  const targetSpace = findContainingSpaceByAnchor(spacesRef.current, spaceAnchor)
  if (!targetSpace) {
    return
  }

  assignNodeToSpaceAndExpand({
    createdNodeId: created.id,
    targetSpaceId: targetSpace.id,
    spacesRef,
    nodesRef,
    setNodes,
    onSpacesChange,
  })
}
