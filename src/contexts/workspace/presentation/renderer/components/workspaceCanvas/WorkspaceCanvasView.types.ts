import type {
  Dispatch,
  MouseEvent as ReactMouseEvent,
  MouseEventHandler,
  PointerEvent as ReactPointerEvent,
  PointerEventHandler,
  RefObject,
  SetStateAction,
} from 'react'
import type { Edge, Node, NodeTypes, OnNodesChange, Viewport } from '@xyflow/react'
import type { WorkspacePathOpener, WorkspacePathOpenerId } from '@shared/contracts/dto'
import type { TerminalNodeData, WorkspaceSpaceRect, WorkspaceSpaceState } from '../../types'
import type { WorkspaceArrangeStyle } from '../../utils/workspaceArrange'
import type { WorkspaceSnapGuide } from '../../utils/workspaceSnap'
import type {
  ContextMenuState,
  NodeDeleteConfirmationState,
  SelectionDraftState,
  SpaceActionMenuState,
  SpaceVisual,
  SpaceWorktreeDialogState,
  TaskCreatorState,
  TaskEditorState,
  WorkspaceCanvasProps,
} from './types'

export type SelectionDraftUiState = Pick<
  SelectionDraftState,
  'startX' | 'startY' | 'currentX' | 'currentY' | 'phase'
>

export interface WorkspaceCanvasViewProps {
  canvasRef: RefObject<HTMLDivElement | null>
  resolvedCanvasInputMode: string
  onCanvasClick: () => void
  handleCanvasPointerDownCapture: PointerEventHandler<HTMLDivElement>
  handleCanvasPointerMoveCapture: PointerEventHandler<HTMLDivElement>
  handleCanvasPointerUpCapture: PointerEventHandler<HTMLDivElement>
  handleCanvasDoubleClickCapture: MouseEventHandler<HTMLDivElement>
  handleCanvasWheelCapture: (event: WheelEvent) => void
  nodes: Node<TerminalNodeData>[]
  edges: Edge[]
  nodeTypes: NodeTypes
  onNodesChange: OnNodesChange<Node<TerminalNodeData>>
  onPaneClick: (event: ReactMouseEvent | MouseEvent) => void
  onPaneContextMenu: (event: ReactMouseEvent | MouseEvent) => void
  onNodeClick: (event: ReactMouseEvent, node: Node<TerminalNodeData>) => void
  onNodeContextMenu: (event: ReactMouseEvent, node: Node<TerminalNodeData>) => void
  onSelectionContextMenu: (event: ReactMouseEvent, selectedNodes: Node<TerminalNodeData>[]) => void
  onSelectionChange: (params: { nodes: Node<TerminalNodeData>[] }) => void
  onNodeDragStart: (
    event: ReactMouseEvent,
    node: Node<TerminalNodeData>,
    nodes: Node<TerminalNodeData>[],
  ) => void
  onSelectionDragStart: (event: ReactMouseEvent, nodes: Node<TerminalNodeData>[]) => void
  onNodeDragStop: (
    event: ReactMouseEvent,
    node: Node<TerminalNodeData>,
    nodes: Node<TerminalNodeData>[],
  ) => void
  onSelectionDragStop: (event: ReactMouseEvent, nodes: Node<TerminalNodeData>[]) => void
  onMoveEnd: (_event: MouseEvent | TouchEvent | null, nextViewport: Viewport) => void
  viewport: Viewport
  isTrackpadCanvasMode: boolean
  useManualCanvasWheelGestures: boolean
  isShiftPressed: boolean
  selectionDraft: SelectionDraftUiState | null
  snapGuides: WorkspaceSnapGuide[] | null
  spaceVisuals: SpaceVisual[]
  spaceFramePreview: { spaceId: string; rect: WorkspaceSpaceRect } | null
  selectedSpaceIds: string[]
  handleSpaceDragHandlePointerDown: (
    event: ReactPointerEvent<HTMLDivElement> | ReactMouseEvent<HTMLDivElement>,
    spaceId: string,
    options?: { mode?: 'auto' | 'region' },
  ) => void
  editingSpaceId: string | null
  spaceRenameInputRef: RefObject<HTMLInputElement | null>
  spaceRenameDraft: string
  setSpaceRenameDraft: Dispatch<SetStateAction<string>>
  commitSpaceRename: (spaceId: string) => void
  cancelSpaceRename: () => void
  startSpaceRename: (spaceId: string) => void
  selectedNodeCount: number
  isMinimapVisible: boolean
  minimapNodeColor: (node: Node<TerminalNodeData>) => string
  setIsMinimapVisible: Dispatch<SetStateAction<boolean>>
  onMinimapVisibilityChange: (isVisible: boolean) => void
  spaces: WorkspaceSpaceState[]
  focusSpaceInViewport: (spaceId: string) => void
  focusAllInViewport: () => void
  contextMenu: ContextMenuState | null
  closeContextMenu: () => void
  magneticSnappingEnabled: boolean
  onToggleMagneticSnapping: () => void
  createTerminalNode: () => Promise<void>
  createNoteNodeFromContextMenu: () => void
  arrangeAll: (style?: WorkspaceArrangeStyle) => void
  arrangeCanvas: (style?: WorkspaceArrangeStyle) => void
  arrangeInSpace: (spaceId: string, style?: WorkspaceArrangeStyle) => void
  openTaskCreator: () => void
  openAgentLauncher: () => void
  createSpaceFromSelectedNodes: () => void
  clearNodeSelection: () => void
  canConvertSelectedNoteToTask: boolean
  isConvertSelectedNoteToTaskDisabled: boolean
  convertSelectedNoteToTask: () => void
  taskCreator: TaskCreatorState | null
  taskTitleProviderLabel: string
  taskTitleModelLabel: string
  taskTagOptions: string[]
  setTaskCreator: Dispatch<SetStateAction<TaskCreatorState | null>>
  closeTaskCreator: () => void
  generateTaskTitle: () => Promise<void>
  createTask: () => Promise<void>
  taskEditor: TaskEditorState | null
  setTaskEditor: Dispatch<SetStateAction<TaskEditorState | null>>
  closeTaskEditor: () => void
  generateTaskEditorTitle: () => Promise<void>
  saveTaskEdits: () => Promise<void>
  nodeDeleteConfirmation: NodeDeleteConfirmationState | null
  setNodeDeleteConfirmation: Dispatch<SetStateAction<NodeDeleteConfirmationState | null>>
  confirmNodeDelete: () => Promise<void>
  agentSettings: WorkspaceCanvasProps['agentSettings']
  workspacePath: string
  spaceActionMenu: SpaceActionMenuState | null
  availablePathOpeners: WorkspacePathOpener[]
  openSpaceActionMenu: (spaceId: string, anchor: { x: number; y: number }) => void
  closeSpaceActionMenu: () => void
  copySpacePath: (spaceId: string) => Promise<void> | void
  openSpacePath: (spaceId: string, openerId: WorkspacePathOpenerId) => Promise<void> | void
  spaceWorktreeDialog: SpaceWorktreeDialogState | null
  worktreesRoot: string
  openSpaceCreateWorktree: (spaceId: string) => void
  openSpaceArchive: (spaceId: string) => void
  closeSpaceWorktree: () => void
  onShowMessage?: WorkspaceCanvasProps['onShowMessage']
  updateSpaceDirectory: (
    spaceId: string,
    directoryPath: string,
    options?: {
      markNodeDirectoryMismatch?: boolean
      archiveSpace?: boolean
      renameSpaceTo?: string
    },
  ) => void
  getSpaceBlockingNodes: (spaceId: string) => { agentNodeIds: string[]; terminalNodeIds: string[] }
  closeNodesById: (nodeIds: string[]) => Promise<void>
}
