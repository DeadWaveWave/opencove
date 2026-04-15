import React from 'react'
import type { Edge, Node, ReactFlowInstance } from '@xyflow/react'
import type {
  DocumentNodeData,
  ImageNodeData,
  Point,
  TerminalNodeData,
  WorkspaceSpaceRect,
  WorkspaceSpaceState,
} from '../../../types'
import type { NodeCreationPlacementOptions, WorkspaceCanvasQuickPreviewState } from '../types'
import type { SpaceExplorerClipboardItem } from '../view/WorkspaceSpaceExplorerOverlay.operations'
import type { WorkspaceCanvasNodeDragSession } from './useNodeDragSession'
import type { ExplorerPlacementPx } from './useSpaceExplorer.placement'
import type { SpaceExplorerOpenDocumentBlock } from './useSpaceExplorer.guards'

export type WorkspaceCanvasSpaceExplorerArgs = {
  canvasRef: React.RefObject<HTMLDivElement | null>
  spaces: WorkspaceSpaceState[]
  spacesRef: React.MutableRefObject<WorkspaceSpaceState[]>
  nodesRef: React.MutableRefObject<Node<TerminalNodeData>[]>
  setNodes: (
    updater: (prevNodes: Node<TerminalNodeData>[]) => Node<TerminalNodeData>[],
    options?: { syncLayout?: boolean },
  ) => void
  onSpacesChange: (spaces: WorkspaceSpaceState[]) => void
  onRequestPersistFlush?: () => void
  reactFlow: ReactFlowInstance<Node<TerminalNodeData>, Edge>
  nodeDragSession: WorkspaceCanvasNodeDragSession
  finalizeDraggedNodeDrop: (input: {
    draggedNodeIds: string[]
    draggedNodePositionById: Map<string, { x: number; y: number }>
    dragStartNodePositionById: Map<string, { x: number; y: number }>
    dragStartAllNodePositionById?: Map<string, { x: number; y: number }>
    dragStartSpaceRectById?: Map<string, WorkspaceSpaceRect>
    dropFlowPoint: { x: number; y: number }
    fallbackNodes: Node<TerminalNodeData>[]
    spaceRectOverrideById?: ReadonlyMap<string, WorkspaceSpaceRect> | null
  }) => void
  createDocumentNode: (
    anchor: Point,
    document: DocumentNodeData,
    placement?: NodeCreationPlacementOptions,
  ) => Node<TerminalNodeData> | null
  createImageNode: (
    anchor: Point,
    image: ImageNodeData,
    placement?: NodeCreationPlacementOptions,
  ) => Node<TerminalNodeData> | null
  standardWindowSizeBucket: 'compact' | 'regular' | 'large'
}

export type WorkspaceCanvasSpaceExplorerResult = {
  openExplorerSpaceId: string | null
  explorerClipboard: SpaceExplorerClipboardItem | null
  quickPreview: WorkspaceCanvasQuickPreviewState | null
  openSpaceExplorer: (spaceId: string) => void
  closeSpaceExplorer: () => void
  toggleSpaceExplorer: (spaceId: string) => void
  setExplorerClipboard: (next: SpaceExplorerClipboardItem | null) => void
  findBlockingOpenDocument: (uri: string) => SpaceExplorerOpenDocumentBlock | null
  previewFileInSpace: (
    spaceId: string,
    uri: string,
    options?: { explorerPlacementPx?: ExplorerPlacementPx },
  ) => void
  openFileInSpace: (
    spaceId: string,
    uri: string,
    options?: { explorerPlacementPx?: ExplorerPlacementPx },
  ) => void
  dismissQuickPreview: () => void
  materializeQuickPreview: () => void
  beginQuickPreviewDrag: (event: React.MouseEvent<HTMLElement>) => void
}
