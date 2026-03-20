import type { Edge, Node, ReactFlowInstance } from '@xyflow/react'
import type { Point, TerminalNodeData, WorkspaceSpaceState } from '../../../types'
import type {
  ContextMenuState,
  CreateNodeInput,
  EmptySelectionPromptState,
  SelectionDraftState,
} from '../types'
import type { SetNodes } from './useSpaceOwnership.helpers'

export type SelectionDraftUiState = Pick<
  SelectionDraftState,
  'startX' | 'startY' | 'currentX' | 'currentY' | 'phase'
>

export interface UseWorkspaceCanvasInteractionsParams {
  isTrackpadCanvasMode: boolean
  normalizeZoomOnNodeClick: boolean
  defaultTerminalWindowScalePercent: number
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
  workspacePath: string
  defaultTerminalProfileId: string | null
  spacesRef: React.MutableRefObject<WorkspaceSpaceState[]>
  onSpacesChange: (spaces: WorkspaceSpaceState[]) => void
  nodesRef: React.MutableRefObject<Node<TerminalNodeData>[]>
  createNodeForSession: (input: CreateNodeInput) => Promise<Node<TerminalNodeData> | null>
  createNoteNode: (anchor: Point) => Node<TerminalNodeData> | null
}
