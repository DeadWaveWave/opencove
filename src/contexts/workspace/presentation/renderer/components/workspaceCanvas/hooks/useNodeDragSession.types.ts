import type { MutableRefObject } from 'react'
import type { Node } from '@xyflow/react'
import type { TerminalNodeData, WorkspaceSpaceRect } from '../../../types'

export interface WorkspaceCanvasNodeDragSession {
  nodeDragPointerAnchorRef: MutableRefObject<{
    nodeId: string
    offset: { x: number; y: number }
  } | null>
  dragBaselinePositionByIdRef: MutableRefObject<Map<string, { x: number; y: number }> | null>
  dragBaselineSpaceRectByIdRef: MutableRefObject<Map<string, WorkspaceSpaceRect> | null>
  beginNodeDragSession: (currentNodes: Node<TerminalNodeData>[]) => void
  projectNodeDrag: (options: {
    currentNodes: Node<TerminalNodeData>[]
    draggedNodeIds: string[]
    desiredDraggedPositionById: Map<string, { x: number; y: number }>
    dropFlowPoint?: { x: number; y: number } | null
    anchorNodeId?: string | null
    anchorIsSelected?: boolean
  }) => {
    nextNodes: Node<TerminalNodeData>[]
    nextDraggedNodePositionById: Map<string, { x: number; y: number }>
    nextSpaceFramePreview: ReadonlyMap<string, WorkspaceSpaceRect> | null
  }
  applyPendingReleaseProjection: (
    currentNodes: Node<TerminalNodeData>[],
  ) => Node<TerminalNodeData>[]
  /** Ends the session; returns the Space frames its release writes (Space-dominant), or null. */
  endNodeDragSession: () => ReadonlyMap<string, WorkspaceSpaceRect> | null
  clearNodeDragProjection: () => void
  /** Copies the selected Space ids for the length of one node drag. */
  captureDragStartSpaceSelection: () => void
  getDragStartSpaceSelection: () => readonly string[] | null
  clearDragStartSpaceSelection: () => void
}
