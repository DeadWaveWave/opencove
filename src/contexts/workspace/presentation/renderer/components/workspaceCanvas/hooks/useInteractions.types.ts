import type { Edge, Node, ReactFlowInstance } from '@xyflow/react'
import type { StandardWindowSizeBucket } from '@contexts/settings/domain/agentSettings'
import type {
  ImageNodeData,
  Point,
  TerminalNodeData,
  WebsiteNodeData,
  WorkspaceSpaceState,
} from '../../../types'
import type {
  ContextMenuState,
  CreateNodeInput,
  EmptySelectionPromptState,
  SelectionDraftState,
  ShowWorkspaceCanvasMessage,
} from '../types'

export type SetNodes = (
  updater: (prevNodes: Node<TerminalNodeData>[]) => Node<TerminalNodeData>[],
  options?: { syncLayout?: boolean },
) => void

export type SelectionDraftUiState = Pick<
  SelectionDraftState,
  'startX' | 'startY' | 'currentX' | 'currentY' | 'phase'
>

export interface UseWorkspaceCanvasInteractionsParams {
  canvasRef: React.RefObject<HTMLDivElement | null>
  isTrackpadCanvasMode: boolean
  focusNodeOnClick: boolean
  focusNodeTargetZoom: number
  websiteWindowsEnabled: boolean
  websiteWindowPasteEnabled: boolean
  isShiftPressedRef: React.MutableRefObject<boolean>
  selectionDraftRef: React.MutableRefObject<SelectionDraftState | null>
  setSelectionDraftUi: React.Dispatch<React.SetStateAction<SelectionDraftUiState | null>>
  reactFlow: ReactFlowInstance<Node<TerminalNodeData>, Edge>
  setNodes: SetNodes
  setSelectedNodeIds: React.Dispatch<React.SetStateAction<string[]>>
  setSelectedSpaceIds: React.Dispatch<React.SetStateAction<string[]>>
  setContextMenu: React.Dispatch<React.SetStateAction<ContextMenuState | null>>
  setEmptySelectionPrompt: React.Dispatch<React.SetStateAction<EmptySelectionPromptState | null>>
  cancelSpaceRename: () => void
  selectedNodeIdsRef: React.MutableRefObject<string[]>
  selectedSpaceIdsRef: React.MutableRefObject<string[]>
  contextMenu: ContextMenuState | null
  workspaceId: string
  workspacePath: string
  defaultTerminalProfileId: string | null
  spacesRef: React.MutableRefObject<WorkspaceSpaceState[]>
  onSpacesChange: (spaces: WorkspaceSpaceState[]) => void
  nodesRef: React.MutableRefObject<Node<TerminalNodeData>[]>
  standardWindowSizeBucket: StandardWindowSizeBucket
  createNodeForSession: (input: CreateNodeInput) => Promise<Node<TerminalNodeData> | null>
  createNoteNode: (
    anchor: Point,
    options?: {
      placementStrategy?: 'default' | 'right-no-push'
      initialText?: string
      placement?: {
        targetSpaceRect?: WorkspaceSpaceState['rect']
      }
    },
  ) => Node<TerminalNodeData> | null
  onShowMessage?: ShowWorkspaceCanvasMessage
  createImageNode: (
    anchor: Point,
    image: ImageNodeData,
    placement?: { targetSpaceRect?: WorkspaceSpaceState['rect'] | null },
  ) => Node<TerminalNodeData> | null
  createWebsiteNode: (
    anchor: Point,
    website: WebsiteNodeData,
    placement?: { targetSpaceRect?: WorkspaceSpaceState['rect'] | null },
  ) => Node<TerminalNodeData> | null
}
