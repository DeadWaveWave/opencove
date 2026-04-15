import type * as React from 'react'
import type { Edge, Node, NodeTypes, OnNodesChange, Viewport } from '@xyflow/react'
import type { WorkspacePathOpener, WorkspacePathOpenerId } from '@shared/contracts/dto'
import type { LabelColor, NodeLabelColorOverride } from '@shared/types/labelColor'
import type { QuickCommand, QuickPhrase } from '@contexts/settings/domain/agentSettings'
import type {
  AgentNodeData,
  TerminalNodeData,
  WorkspaceSpaceRect,
  WorkspaceSpaceState,
} from '../../types'
import type { WorkspaceArrangeStyle } from '../../utils/workspaceArrange'
import type { WorkspaceSnapGuide } from '../../utils/workspaceSnap'
import type { SpaceExplorerOpenDocumentBlock } from './hooks/useSpaceExplorer.guards'
import type {
  ContextMenuState,
  NodeDeleteConfirmationState,
  SelectionDraftState,
  SpaceActionMenuState,
  SpaceVisual,
  SpaceWorktreeMismatchDropWarningState,
  SpaceTargetMountPickerState,
  SpaceWorktreeDialogState,
  TaskCreatorState,
  TaskEditorState,
  WorkspaceCanvasQuickPreviewState,
  WorkspaceCanvasProps,
} from './types'
import type { SpaceExplorerClipboardItem } from './view/WorkspaceSpaceExplorerOverlay.operations'

export type SelectionDraftUiState = Pick<
  SelectionDraftState,
  'startX' | 'startY' | 'currentX' | 'currentY' | 'phase'
>

export interface WorkspaceCanvasViewProps {
  canvasRef: React.RefObject<HTMLDivElement | null>
  resolvedCanvasInputMode: string
  onCanvasClick: () => void
  handleCanvasPointerDownCapture: React.PointerEventHandler<HTMLDivElement>
  handleCanvasPointerMoveCapture: React.PointerEventHandler<HTMLDivElement>
  handleCanvasPointerUpCapture: React.PointerEventHandler<HTMLDivElement>
  handleCanvasDoubleClickCapture: React.MouseEventHandler<HTMLDivElement>
  handleCanvasWheelCapture: (event: WheelEvent) => void
  handleCanvasPaste?: React.ClipboardEventHandler<HTMLDivElement>
  handleCanvasDragOver?: React.DragEventHandler<HTMLDivElement>
  handleCanvasDrop?: React.DragEventHandler<HTMLDivElement>
  nodes: Node<TerminalNodeData>[]
  edges: Edge[]
  nodeTypes: NodeTypes
  onNodesChange: OnNodesChange<Node<TerminalNodeData>>
  onPaneClick: (event: React.MouseEvent | MouseEvent) => void
  onPaneContextMenu: (event: React.MouseEvent | MouseEvent) => void
  onNodeClick: (event: React.MouseEvent, node: Node<TerminalNodeData>) => void
  onNodeContextMenu: (event: React.MouseEvent, node: Node<TerminalNodeData>) => void
  onSelectionContextMenu: (event: React.MouseEvent, selectedNodes: Node<TerminalNodeData>[]) => void
  onSelectionChange: (params: { nodes: Node<TerminalNodeData>[] }) => void
  onNodeDragStart: (
    event: React.MouseEvent,
    node: Node<TerminalNodeData>,
    nodes: Node<TerminalNodeData>[],
  ) => void
  onSelectionDragStart: (event: React.MouseEvent, nodes: Node<TerminalNodeData>[]) => void
  onNodeDragStop: (
    event: React.MouseEvent,
    node: Node<TerminalNodeData>,
    nodes: Node<TerminalNodeData>[],
  ) => void
  onSelectionDragStop: (event: React.MouseEvent, nodes: Node<TerminalNodeData>[]) => void
  onMoveEnd: (_event: MouseEvent | TouchEvent | null, nextViewport: Viewport) => void
  viewport: Viewport
  isTrackpadCanvasMode: boolean
  useManualCanvasWheelGestures: boolean
  isShiftPressed: boolean
  selectionDraft: SelectionDraftUiState | null
  snapGuides: WorkspaceSnapGuide[] | null
  spaceVisuals: SpaceVisual[]
  spaceFramePreview: ReadonlyMap<string, WorkspaceSpaceRect> | null
  selectedSpaceIds: string[]
  openExplorerSpaceId: string | null
  explorerClipboard: SpaceExplorerClipboardItem | null
  quickPreview: WorkspaceCanvasQuickPreviewState | null
  toggleSpaceExplorer: (spaceId: string) => void
  closeSpaceExplorer: () => void
  setExplorerClipboard: (next: SpaceExplorerClipboardItem | null) => void
  findBlockingOpenDocument: (uri: string) => SpaceExplorerOpenDocumentBlock | null
  previewFileInSpace: (
    spaceId: string,
    uri: string,
    options?: {
      explorerPlacementPx?: { left: number; top: number; width: number; height: number }
    },
  ) => void
  openFileInSpace: (
    spaceId: string,
    uri: string,
    options?: {
      explorerPlacementPx?: { left: number; top: number; width: number; height: number }
    },
  ) => void
  dismissQuickPreview: () => void
  materializeQuickPreview: () => void
  beginQuickPreviewDrag: (event: React.MouseEvent<HTMLElement>) => void
  handleSpaceDragHandlePointerDown: (
    event: React.PointerEvent<HTMLDivElement> | React.MouseEvent<HTMLDivElement>,
    spaceId: string,
    options?: { mode?: 'auto' | 'region' },
  ) => void
  editingSpaceId: string | null
  spaceRenameInputRef: React.RefObject<HTMLInputElement | null>
  spaceRenameDraft: string
  setSpaceRenameDraft: React.Dispatch<React.SetStateAction<string>>
  commitSpaceRename: (spaceId: string) => void
  cancelSpaceRename: () => void
  startSpaceRename: (spaceId: string) => void
  setSpaceLabelColor: (spaceId: string, labelColor: LabelColor | null) => void
  selectedNodeCount: number
  isMinimapVisible: boolean
  minimapNodeColor: (node: Node<TerminalNodeData>) => string
  setIsMinimapVisible: React.Dispatch<React.SetStateAction<boolean>>
  onMinimapVisibilityChange: (isVisible: boolean) => void
  spaces: WorkspaceSpaceState[]
  activateSpace: (spaceId: string) => void
  activateAllSpaces: () => void
  contextMenu: ContextMenuState | null
  closeContextMenu: () => void
  magneticSnappingEnabled: boolean
  onToggleMagneticSnapping: () => void
  createTerminalNode: () => Promise<void>
  createNoteNodeFromContextMenu: () => void
  createWebsiteNodeFromContextMenu: () => void
  arrangeAll: (style?: WorkspaceArrangeStyle) => void
  arrangeCanvas: (style?: WorkspaceArrangeStyle) => void
  arrangeInSpace: (spaceId: string, style?: WorkspaceArrangeStyle) => void
  openTaskCreator: () => void
  openAgentLauncher: () => void
  openAgentLauncherForProvider: (provider: AgentNodeData['provider']) => void
  runQuickCommand: (command: QuickCommand) => Promise<void>
  insertQuickPhrase: (phrase: QuickPhrase) => void
  openQuickMenuSettings: () => void
  createSpaceFromSelectedNodes: () => void
  spaceTargetMountPicker: SpaceTargetMountPickerState | null
  setSpaceTargetMountPicker: React.Dispatch<
    React.SetStateAction<SpaceTargetMountPickerState | null>
  >
  confirmSpaceTargetMountPicker: () => void
  cancelSpaceTargetMountPicker: () => void
  clearNodeSelection: () => void
  canConvertSelectedNoteToTask: boolean
  isConvertSelectedNoteToTaskDisabled: boolean
  convertSelectedNoteToTask: () => void
  setSelectedNodeLabelColorOverride: (labelColorOverride: NodeLabelColorOverride) => void
  taskCreator: TaskCreatorState | null
  taskTitleProviderLabel: string
  taskTitleModelLabel: string
  taskTagOptions: string[]
  setTaskCreator: React.Dispatch<React.SetStateAction<TaskCreatorState | null>>
  closeTaskCreator: () => void
  generateTaskTitle: () => Promise<void>
  createTask: () => Promise<void>
  taskEditor: TaskEditorState | null
  setTaskEditor: React.Dispatch<React.SetStateAction<TaskEditorState | null>>
  closeTaskEditor: () => void
  generateTaskEditorTitle: () => Promise<void>
  saveTaskEdits: () => Promise<void>
  nodeDeleteConfirmation: NodeDeleteConfirmationState | null
  setNodeDeleteConfirmation: React.Dispatch<
    React.SetStateAction<NodeDeleteConfirmationState | null>
  >
  confirmNodeDelete: () => Promise<void>
  spaceWorktreeMismatchDropWarning: SpaceWorktreeMismatchDropWarningState | null
  cancelSpaceWorktreeMismatchDropWarning: () => void
  continueSpaceWorktreeMismatchDropWarning: () => void
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
  onAppendSpaceArchiveRecord: WorkspaceCanvasProps['onAppendSpaceArchiveRecord']
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
