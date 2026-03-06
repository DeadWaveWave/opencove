import React from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  PanOnScrollMode,
  ReactFlow,
  SelectionMode,
  type OnNodesChange,
  type Edge,
  type Node,
  type NodeTypes,
  type Viewport,
} from '@xyflow/react'
import type { TerminalNodeData, WorkspaceSpaceRect, WorkspaceSpaceState } from '../../types'
import { MAX_CANVAS_ZOOM, MIN_CANVAS_ZOOM } from './constants'
import type {
  ContextMenuState,
  SpaceVisual,
  WorkspaceCanvasProps,
  TaskAssignerState,
  TaskCreatorState,
  TaskDeleteConfirmationState,
  TaskEditorState,
} from './types'
import { WorkspaceContextMenu } from './view/WorkspaceContextMenu'
import { WorkspaceMinimapDock } from './view/WorkspaceMinimapDock'
import { WorkspaceSpaceRegionsOverlay } from './view/WorkspaceSpaceRegionsOverlay'
import { WorkspaceSpaceSwitcher } from './view/WorkspaceSpaceSwitcher'
import { TaskAssignerWindow } from './windows/TaskAssignerWindow'
import { TaskCreatorWindow } from './windows/TaskCreatorWindow'
import { TaskDeleteConfirmationWindow } from './windows/TaskDeleteConfirmationWindow'
import { TaskEditorWindow } from './windows/TaskEditorWindow'
import { SpaceWorktreeWindow } from './windows/SpaceWorktreeWindow'

interface WorkspaceCanvasViewProps {
  canvasRef: React.RefObject<HTMLDivElement>
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
  isShiftPressed: boolean

  spaceVisuals: SpaceVisual[]
  spaceFramePreview: { spaceId: string; rect: WorkspaceSpaceRect } | null
  handleSpaceDragHandlePointerDown: (
    event: React.PointerEvent<HTMLDivElement> | React.MouseEvent<HTMLDivElement>,
    spaceId: string,
  ) => void
  editingSpaceId: string | null
  spaceRenameInputRef: React.RefObject<HTMLInputElement>
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
  openTaskCreator: () => void
  openAgentLauncher: () => void
  createSpaceFromSelectedNodes: () => void
  clearNodeSelection: () => void

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

  taskAssigner: TaskAssignerState | null
  activeTaskTitleForAssigner: string | null
  taskAssignerAgentOptions: Array<{
    nodeId: string
    title: string
    status: TerminalNodeData['status']
    linkedTaskTitle: string | null
  }>
  setTaskAssigner: React.Dispatch<React.SetStateAction<TaskAssignerState | null>>
  closeTaskAssigner: () => void
  applyTaskAssignment: () => Promise<void>

  taskDeleteConfirmation: TaskDeleteConfirmationState | null
  setTaskDeleteConfirmation: React.Dispatch<
    React.SetStateAction<TaskDeleteConfirmationState | null>
  >
  confirmTaskDelete: () => Promise<void>

  agentSettings: WorkspaceCanvasProps['agentSettings']
  workspacePath: string

  spaceWorktreeSpaceId: string | null
  worktreesRoot: string
  openSpaceWorktree: (spaceId: string) => void
  closeSpaceWorktree: () => void
  updateSpaceDirectory: (
    spaceId: string,
    directoryPath: string,
    options?: { markNodeDirectoryMismatch?: boolean },
  ) => void
  getSpaceBlockingNodes: (spaceId: string) => { agentNodeIds: string[]; terminalNodeIds: string[] }
  closeNodesById: (nodeIds: string[]) => Promise<void>
}

export function WorkspaceCanvasView({
  canvasRef,
  resolvedCanvasInputMode,
  onCanvasClick,
  handleCanvasPointerDownCapture,
  handleCanvasPointerMoveCapture,
  handleCanvasPointerUpCapture,
  handleCanvasDoubleClickCapture,
  handleCanvasWheelCapture,
  nodes,
  edges,
  nodeTypes,
  onNodesChange,
  onPaneClick,
  onPaneContextMenu,
  onNodeContextMenu,
  onSelectionContextMenu,
  onSelectionChange,
  onNodeDragStart,
  onSelectionDragStart,
  onNodeDragStop,
  onSelectionDragStop,
  onMoveEnd,
  viewport,
  isTrackpadCanvasMode,
  isShiftPressed,
  spaceVisuals,
  spaceFramePreview,
  handleSpaceDragHandlePointerDown,
  editingSpaceId,
  spaceRenameInputRef,
  spaceRenameDraft,
  setSpaceRenameDraft,
  commitSpaceRename,
  cancelSpaceRename,
  startSpaceRename,
  selectedNodeCount,
  isMinimapVisible,
  minimapNodeColor,
  setIsMinimapVisible,
  onMinimapVisibilityChange,
  spaces,
  focusSpaceInViewport,
  focusAllInViewport,
  contextMenu,
  closeContextMenu,
  createTerminalNode,
  openTaskCreator,
  openAgentLauncher,
  createSpaceFromSelectedNodes,
  clearNodeSelection,
  taskCreator,
  taskTitleProviderLabel,
  taskTitleModelLabel,
  taskTagOptions,
  setTaskCreator,
  closeTaskCreator,
  generateTaskTitle,
  createTask,
  taskEditor,
  setTaskEditor,
  closeTaskEditor,
  generateTaskEditorTitle,
  saveTaskEdits,
  taskAssigner,
  activeTaskTitleForAssigner,
  taskAssignerAgentOptions,
  setTaskAssigner,
  closeTaskAssigner,
  applyTaskAssignment,
  taskDeleteConfirmation,
  setTaskDeleteConfirmation,
  confirmTaskDelete,
  agentSettings,
  workspacePath,
  spaceWorktreeSpaceId,
  worktreesRoot,
  openSpaceWorktree,
  closeSpaceWorktree,
  updateSpaceDirectory,
  getSpaceBlockingNodes,
  closeNodesById,
}: WorkspaceCanvasViewProps): React.JSX.Element {
  return (
    <div
      ref={canvasRef}
      className="workspace-canvas"
      data-canvas-input-mode={resolvedCanvasInputMode}
      onClick={onCanvasClick}
      onDoubleClickCapture={handleCanvasDoubleClickCapture}
      onPointerDownCapture={handleCanvasPointerDownCapture}
      onPointerMoveCapture={handleCanvasPointerMoveCapture}
      onPointerUpCapture={handleCanvasPointerUpCapture}
      onWheelCapture={event => {
        handleCanvasWheelCapture(event.nativeEvent)
      }}
    >
      <ReactFlow<Node<TerminalNodeData>, Edge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onPaneClick={onPaneClick}
        onPaneContextMenu={onPaneContextMenu}
        onNodeContextMenu={onNodeContextMenu}
        onSelectionContextMenu={onSelectionContextMenu}
        onSelectionChange={onSelectionChange}
        onNodeDragStart={onNodeDragStart}
        onSelectionDragStart={onSelectionDragStart}
        onNodeDragStop={onNodeDragStop}
        onSelectionDragStop={onSelectionDragStop}
        onMoveEnd={onMoveEnd}
        selectionMode={SelectionMode.Partial}
        selectionKeyCode={null}
        multiSelectionKeyCode={null}
        selectionOnDrag={isTrackpadCanvasMode || isShiftPressed}
        nodesDraggable
        elementsSelectable
        panOnDrag={isTrackpadCanvasMode ? false : !isShiftPressed}
        zoomOnScroll={!isTrackpadCanvasMode}
        panOnScroll={false}
        panOnScrollMode={PanOnScrollMode.Free}
        zoomOnPinch={!isTrackpadCanvasMode}
        zoomOnDoubleClick={false}
        defaultViewport={viewport}
        minZoom={MIN_CANVAS_ZOOM}
        maxZoom={MAX_CANVAS_ZOOM}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} size={1} gap={24} color="#20324f" />
        <WorkspaceSpaceRegionsOverlay
          workspacePath={workspacePath}
          spaceVisuals={spaceVisuals}
          spaceFramePreview={spaceFramePreview}
          handleSpaceDragHandlePointerDown={handleSpaceDragHandlePointerDown}
          editingSpaceId={editingSpaceId}
          spaceRenameInputRef={spaceRenameInputRef}
          spaceRenameDraft={spaceRenameDraft}
          setSpaceRenameDraft={setSpaceRenameDraft}
          commitSpaceRename={commitSpaceRename}
          cancelSpaceRename={cancelSpaceRename}
          startSpaceRename={startSpaceRename}
          onOpenSpaceMenu={spaceId => {
            openSpaceWorktree(spaceId)
          }}
        />

        {selectedNodeCount > 0 ? (
          <div className="workspace-selection-hint">
            Selected {selectedNodeCount} node{selectedNodeCount > 1 ? 's' : ''}. Right-click to
            manage workspace grouping.
          </div>
        ) : null}

        <WorkspaceMinimapDock
          isMinimapVisible={isMinimapVisible}
          minimapNodeColor={minimapNodeColor}
          setIsMinimapVisible={setIsMinimapVisible}
          onMinimapVisibilityChange={onMinimapVisibilityChange}
        />

        <Controls className="workspace-canvas__controls" showInteractive={false} />
      </ReactFlow>

      <WorkspaceSpaceSwitcher
        spaces={spaces}
        focusSpaceInViewport={focusSpaceInViewport}
        focusAllInViewport={focusAllInViewport}
        cancelSpaceRename={cancelSpaceRename}
      />

      <WorkspaceContextMenu
        contextMenu={contextMenu}
        closeContextMenu={closeContextMenu}
        createTerminalNode={createTerminalNode}
        openTaskCreator={openTaskCreator}
        openAgentLauncher={openAgentLauncher}
        createSpaceFromSelectedNodes={createSpaceFromSelectedNodes}
        clearNodeSelection={clearNodeSelection}
      />

      <TaskCreatorWindow
        taskCreator={taskCreator}
        taskTitleProviderLabel={taskTitleProviderLabel}
        taskTitleModelLabel={taskTitleModelLabel}
        taskTagOptions={taskTagOptions}
        setTaskCreator={setTaskCreator}
        closeTaskCreator={closeTaskCreator}
        generateTaskTitle={generateTaskTitle}
        createTask={createTask}
      />

      <TaskEditorWindow
        taskEditor={taskEditor}
        taskTitleProviderLabel={taskTitleProviderLabel}
        taskTitleModelLabel={taskTitleModelLabel}
        taskTagOptions={taskTagOptions}
        setTaskEditor={setTaskEditor}
        closeTaskEditor={closeTaskEditor}
        generateTaskEditorTitle={generateTaskEditorTitle}
        saveTaskEdits={saveTaskEdits}
      />

      <TaskAssignerWindow
        taskAssigner={taskAssigner}
        activeTaskTitle={activeTaskTitleForAssigner}
        agentOptions={taskAssignerAgentOptions}
        setTaskAssigner={setTaskAssigner}
        closeTaskAssigner={closeTaskAssigner}
        applyTaskAssignment={applyTaskAssignment}
      />

      <TaskDeleteConfirmationWindow
        taskDeleteConfirmation={taskDeleteConfirmation}
        setTaskDeleteConfirmation={setTaskDeleteConfirmation}
        confirmTaskDelete={confirmTaskDelete}
      />


      <SpaceWorktreeWindow
        spaceId={spaceWorktreeSpaceId}
        spaces={spaces}
        nodes={nodes}
        workspacePath={workspacePath}
        worktreesRoot={worktreesRoot}
        agentSettings={agentSettings}
        onClose={closeSpaceWorktree}
        onUpdateSpaceDirectory={(spaceId, directoryPath, options) => {
          updateSpaceDirectory(spaceId, directoryPath, options)
        }}
        getBlockingNodes={spaceId => getSpaceBlockingNodes(spaceId)}
        closeNodesById={nodeIds => closeNodesById(nodeIds)}
      />
    </div>
  )
}
