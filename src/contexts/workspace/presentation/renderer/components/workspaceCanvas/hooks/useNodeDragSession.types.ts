import type { MutableRefObject } from 'react'
import type { Node } from '@xyflow/react'
import type { TerminalNodeData, WorkspaceSpaceRect } from '../../../types'

export interface WorkspaceCanvasNodeDragSession {
  nodeDragPointerAnchorRef: MutableRefObject<{
    nodeId: string
    offset: { x: number; y: number }
  } | null>
  nodeSpaceFramePreview: ReadonlyMap<string, WorkspaceSpaceRect> | null
  nodeSpaceFramePreviewRef: MutableRefObject<ReadonlyMap<string, WorkspaceSpaceRect> | null>
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
  endNodeDragSession: () => void
  clearNodeDragProjection: () => void
}
