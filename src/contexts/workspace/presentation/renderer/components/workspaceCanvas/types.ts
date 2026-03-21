import type React from 'react'
import type { Edge, Node, NodeTypes, OnNodesChange, Viewport } from '@xyflow/react'
import type {
  AgentNodeData,
  Point,
  TaskPriority,
  TaskRuntimeStatus,
  TerminalNodeData,
  WorkspaceNodeKind,
  WorkspaceSpaceRect,
  WorkspaceSpaceState,
  WorkspaceViewport,
} from '../../types'
import type { AgentSettings } from '@contexts/settings/domain/agentSettings'
import type {
  TerminalRuntimeKind,
  WorkspacePathOpener,
  WorkspacePathOpenerId,
} from '@shared/contracts/dto'

export type WorkspaceCanvasMessageTone = 'info' | 'warning' | 'error'

export type ShowWorkspaceCanvasMessage = (
  message: string,
  tone?: WorkspaceCanvasMessageTone,
) => void

export interface WorkspaceCanvasProps {
  workspaceId: string
  onShowMessage?: ShowWorkspaceCanvasMessage
  workspacePath: string
  worktreesRoot: string
  nodes: Node<TerminalNodeData>[]
  onNodesChange: (nodes: Node<TerminalNodeData>[]) => void
  onRequestPersistFlush?: () => void
  spaces: WorkspaceSpaceState[]
  activeSpaceId: string | null
  onSpacesChange: (spaces: WorkspaceSpaceState[]) => void
  onActiveSpaceChange: (spaceId: string | null) => void
  viewport: WorkspaceViewport
  isMinimapVisible: boolean
  onViewportChange: (viewport: WorkspaceViewport) => void
  onMinimapVisibilityChange: (isVisible: boolean) => void
  agentSettings: AgentSettings
  focusNodeId?: string | null
  focusSequence?: number
}

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
  spaceVisuals: SpaceVisual[]
  spaceFramePreview: { spaceId: string; rect: WorkspaceSpaceRect } | null
  selectedSpaceIds: string[]
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
  selectedNodeCount: number
  isMinimapVisible: boolean
  minimapNodeColor: (node: Node<TerminalNodeData>) => string
  setIsMinimapVisible: React.Dispatch<React.SetStateAction<boolean>>
  onMinimapVisibilityChange: (isVisible: boolean) => void
  spaces: WorkspaceSpaceState[]
  focusSpaceInViewport: (spaceId: string) => void
  focusAllInViewport: () => void
  contextMenu: ContextMenuState | null
  closeContextMenu: () => void
  createTerminalNode: () => Promise<void>
  createNoteNodeFromContextMenu: () => void
  openTaskCreator: () => void
  openAgentLauncher: () => void
  openAgentLauncherForProvider: (provider: AgentNodeData['provider']) => void
  createSpaceFromSelectedNodes: () => void
  clearNodeSelection: () => void
  canConvertSelectedNoteToTask: boolean
  isConvertSelectedNoteToTaskDisabled: boolean
  convertSelectedNoteToTask: () => void
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

export interface PaneContextMenuState {
  kind: 'pane'
  x: number
  y: number
  flowX: number
  flowY: number
}

export interface SelectionContextMenuState {
  kind: 'selection'
  x: number
  y: number
}

export type ContextMenuState = PaneContextMenuState | SelectionContextMenuState

export interface SpaceActionMenuState {
  spaceId: string
  x: number
  y: number
}

export interface SpaceWorktreeDialogState {
  spaceId: string
  initialViewMode: 'create' | 'archive'
}

export interface SelectionDraftState {
  startX: number
  startY: number
  currentX: number
  currentY: number
  pointerId: number
  toggleSelection: boolean
  selectedNodeIdsAtStart: string[]
  selectedSpaceIdsAtStart: string[]
  startSpaceId: string | null
  phase: 'active' | 'settling'
}

export interface EmptySelectionPromptState {
  x: number
  y: number
  rect: WorkspaceSpaceRect
}

export interface SpaceVisual {
  id: string
  name: string
  directoryPath: string
  rect: WorkspaceSpaceRect
  hasExplicitRect: boolean
}

export interface SpaceDragState {
  pointerId: number
  spaceId: string
  startFlow: Point
  startClient: Point
  shiftKey: boolean
  initialRect: WorkspaceSpaceRect
  initialNodePositions: Map<string, Point>
  ownedBounds: { left: number; top: number; right: number; bottom: number } | null
  handle:
    | { kind: 'move' }
    | {
        kind: 'resize'
        edges: Partial<Record<'top' | 'right' | 'bottom' | 'left', true>>
      }
}

export type TrackpadGestureAction = 'pan' | 'pinch'
export type TrackpadGestureTarget = 'canvas' | 'node'

export interface TrackpadGestureLockState {
  action: TrackpadGestureAction
  target: TrackpadGestureTarget
  lastTimestamp: number
}

export interface TaskCreatorState {
  anchor: Point
  title: string
  requirement: string
  priority: TaskPriority
  selectedTags: string[]
  autoGenerateTitle: boolean
  isGeneratingTitle: boolean
  isCreating: boolean
  error: string | null
}

export interface TaskEditorState {
  nodeId: string
  initialTitle: string
  initialAutoGeneratedTitle: boolean
  titleGeneratedInEditor: boolean
  title: string
  requirement: string
  priority: TaskPriority
  selectedTags: string[]
  autoGenerateTitle: boolean
  isGeneratingTitle: boolean
  isSaving: boolean
  error: string | null
}

export interface NodeDeleteConfirmationState {
  nodeIds: string[]
  primaryNodeKind: WorkspaceNodeKind
  primaryNodeTitle: string
}

export interface SpaceWorktreeMismatchDropWarningState {
  spaceId: string
  spaceName: string
  agentCount: number
  terminalCount: number
}

export interface CreateNodeInput {
  sessionId: string
  profileId?: string | null
  runtimeKind?: TerminalRuntimeKind
  title: string
  anchor: Point
  kind: 'terminal' | 'agent'
  agent?: AgentNodeData | null
  executionDirectory?: string | null
  expectedDirectory?: string | null
  placement?: NodePlacementOptions
}

export type NodePlacementDirection = 'right' | 'down' | 'left' | 'up'

export interface NodePlacementOptions {
  targetSpaceRect?: WorkspaceSpaceRect | null
  preferredDirection?: NodePlacementDirection
}

export type QuickUpdateTaskTitle = (nodeId: string, title: string) => void
export type QuickUpdateTaskRequirement = (nodeId: string, requirement: string) => void
export type UpdateTaskStatus = (nodeId: string, status: TaskRuntimeStatus) => void
export type UpdateNodeScrollback = (nodeId: string, scrollback: string) => void
