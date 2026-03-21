import React from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  PanOnScrollMode,
  ReactFlow,
  SelectionMode,
  useStoreApi,
  type Edge,
  type Node,
} from '@xyflow/react'
import { useTranslation } from '@app/renderer/i18n'
import type { TerminalNodeData } from '../../types'
import { MAX_CANVAS_ZOOM, MIN_CANVAS_ZOOM } from './constants'
import type { WorkspaceCanvasViewProps } from './WorkspaceCanvasView.types'
import { WorkspaceContextMenu } from './view/WorkspaceContextMenu'
import { WorkspaceMinimapDock } from './view/WorkspaceMinimapDock'
import { WorkspaceSelectionDraftOverlay } from './view/WorkspaceSelectionDraftOverlay'
import { WorkspaceSpaceActionMenu } from './view/WorkspaceSpaceActionMenu'
import { WorkspaceSpaceRegionsOverlay } from './view/WorkspaceSpaceRegionsOverlay'
import { WorkspaceSpaceSwitcher } from './view/WorkspaceSpaceSwitcher'
import { useWorkspaceCanvasGlobalDismissals } from './hooks/useGlobalDismissals'
import { NodeDeleteConfirmationWindow } from './windows/NodeDeleteConfirmationWindow'
import { SpaceWorktreeMismatchDropWarningWindow } from './windows/SpaceWorktreeMismatchDropWarningWindow'
import { TaskCreatorWindow } from './windows/TaskCreatorWindow'
import { TaskEditorWindow } from './windows/TaskEditorWindow'
import { SpaceWorktreeWindow } from './windows/SpaceWorktreeWindow'

const WHEEL_BLOCK_SELECTOR = '.cove-window, .cove-window-backdrop, .workspace-context-menu'

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
  onNodeClick,
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
  useManualCanvasWheelGestures,
  isShiftPressed,
  selectionDraft,
  spaceVisuals,
  spaceFramePreview,
  selectedSpaceIds,
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
  createNoteNodeFromContextMenu,
  openTaskCreator,
  openAgentLauncher,
  openAgentLauncherForProvider,
  createSpaceFromSelectedNodes,
  clearNodeSelection,
  canConvertSelectedNoteToTask,
  isConvertSelectedNoteToTaskDisabled,
  convertSelectedNoteToTask,
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
  nodeDeleteConfirmation,
  setNodeDeleteConfirmation,
  confirmNodeDelete,
  spaceWorktreeMismatchDropWarning,
  cancelSpaceWorktreeMismatchDropWarning,
  continueSpaceWorktreeMismatchDropWarning,
  agentSettings,
  workspacePath,
  spaceActionMenu,
  availablePathOpeners,
  openSpaceActionMenu,
  closeSpaceActionMenu,
  copySpacePath,
  openSpacePath,
  spaceWorktreeDialog,
  worktreesRoot,
  openSpaceCreateWorktree,
  openSpaceArchive,
  closeSpaceWorktree,
  onShowMessage,
  updateSpaceDirectory,
  getSpaceBlockingNodes,
  closeNodesById,
}: WorkspaceCanvasViewProps): React.JSX.Element {
  const reactFlowStore = useStoreApi()
  const { t } = useTranslation()

  useWorkspaceCanvasGlobalDismissals({
    contextMenu,
    spaceActionMenu,
    closeContextMenu,
    canvasRef,
    selectedNodeCount,
    clearNodeSelection,
  })

  const activeMenuSpace = React.useMemo(
    () =>
      spaceActionMenu
        ? (spaces.find(candidate => candidate.id === spaceActionMenu.spaceId) ?? null)
        : null,
    [spaceActionMenu, spaces],
  )

  const normalizedWorkspacePath = React.useMemo(
    () => normalizeComparablePath(workspacePath),
    [workspacePath],
  )

  const activeMenuSpacePath = React.useMemo(() => {
    if (!activeMenuSpace) {
      return workspacePath
    }

    const trimmed = activeMenuSpace.directoryPath.trim()
    return trimmed.length > 0 ? trimmed : workspacePath
  }, [activeMenuSpace, workspacePath])

  const isActiveMenuSpaceOnWorkspaceRoot =
    normalizeComparablePath(activeMenuSpacePath) === normalizedWorkspacePath

  return (
    <div
      ref={canvasRef}
      className="workspace-canvas"
      data-canvas-input-mode={resolvedCanvasInputMode}
      data-selected-node-count={selectedNodeCount}
      onClick={onCanvasClick}
      onDoubleClickCapture={handleCanvasDoubleClickCapture}
      onPointerDownCapture={event => {
        if (
          event.button === 0 &&
          (contextMenu !== null || spaceActionMenu !== null) &&
          event.target instanceof Element &&
          !event.target.closest('.workspace-context-menu')
        ) {
          closeContextMenu()
        }

        handleCanvasPointerDownCapture(event)
      }}
      onPointerMoveCapture={handleCanvasPointerMoveCapture}
      onPointerUpCapture={handleCanvasPointerUpCapture}
      onWheelCapture={event => {
        if (event.target instanceof Element && event.target.closest(WHEEL_BLOCK_SELECTOR)) {
          return
        }
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
        onNodeClick={onNodeClick}
        onNodeContextMenu={onNodeContextMenu}
        onSelectionContextMenu={onSelectionContextMenu}
        onSelectionChange={onSelectionChange}
        onNodeDragStart={onNodeDragStart}
        onSelectionDragStart={onSelectionDragStart}
        onNodeDragStop={onNodeDragStop}
        onSelectionDragStop={onSelectionDragStop}
        onMoveStart={() => {
          reactFlowStore.setState({
            coveViewportInteractionActive: true,
          } as unknown as Parameters<typeof reactFlowStore.setState>[0])
        }}
        onMoveEnd={(event, nextViewport) => {
          reactFlowStore.setState({
            coveViewportInteractionActive: false,
          } as unknown as Parameters<typeof reactFlowStore.setState>[0])
          onMoveEnd(event, nextViewport)
        }}
        selectionMode={SelectionMode.Partial}
        deleteKeyCode={null}
        selectionKeyCode={null}
        multiSelectionKeyCode={null}
        selectionOnDrag={isTrackpadCanvasMode || isShiftPressed}
        nodesDraggable
        elementsSelectable
        panOnDrag={isTrackpadCanvasMode ? false : !isShiftPressed}
        zoomOnScroll={!useManualCanvasWheelGestures}
        panOnScroll={false}
        panOnScrollMode={PanOnScrollMode.Free}
        zoomOnPinch={!useManualCanvasWheelGestures}
        zoomOnDoubleClick={false}
        defaultViewport={viewport}
        minZoom={MIN_CANVAS_ZOOM}
        maxZoom={MAX_CANVAS_ZOOM}
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          size={1}
          gap={24}
          color="var(--cove-canvas-dot)"
        />
        <WorkspaceSpaceRegionsOverlay
          workspacePath={workspacePath}
          spaceVisuals={spaceVisuals}
          spaceFramePreview={spaceFramePreview}
          selectedSpaceIds={selectedSpaceIds}
          handleSpaceDragHandlePointerDown={handleSpaceDragHandlePointerDown}
          editingSpaceId={editingSpaceId}
          spaceRenameInputRef={spaceRenameInputRef}
          spaceRenameDraft={spaceRenameDraft}
          setSpaceRenameDraft={setSpaceRenameDraft}
          commitSpaceRename={commitSpaceRename}
          cancelSpaceRename={cancelSpaceRename}
          startSpaceRename={startSpaceRename}
          onOpenSpaceMenu={openSpaceActionMenu}
        />

        <WorkspaceMinimapDock
          isMinimapVisible={isMinimapVisible}
          minimapNodeColor={minimapNodeColor}
          setIsMinimapVisible={setIsMinimapVisible}
          onMinimapVisibilityChange={onMinimapVisibilityChange}
        />

        <Controls className="workspace-canvas__controls" showInteractive={false} />
      </ReactFlow>

      <WorkspaceSelectionDraftOverlay canvasRef={canvasRef} draft={selectionDraft} />

      {selectedNodeCount > 0 || spaces.length > 0 ? (
        <div className="workspace-canvas__top-overlays">
          {spaces.length > 0 ? (
            <WorkspaceSpaceSwitcher
              spaces={spaces}
              focusSpaceInViewport={focusSpaceInViewport}
              focusAllInViewport={focusAllInViewport}
              cancelSpaceRename={cancelSpaceRename}
            />
          ) : null}
          {selectedNodeCount > 0 ? (
            <div className="workspace-selection-hint">
              {t('workspaceCanvas.selectionHint', { count: selectedNodeCount })}
            </div>
          ) : null}
        </div>
      ) : null}

      <WorkspaceContextMenu
        contextMenu={contextMenu}
        closeContextMenu={closeContextMenu}
        createTerminalNode={createTerminalNode}
        createNoteNodeFromContextMenu={createNoteNodeFromContextMenu}
        openTaskCreator={openTaskCreator}
        openAgentLauncher={openAgentLauncher}
        agentProviderOrder={agentSettings.agentProviderOrder}
        openAgentLauncherForProvider={openAgentLauncherForProvider}
        createSpaceFromSelectedNodes={createSpaceFromSelectedNodes}
        clearNodeSelection={clearNodeSelection}
        canConvertSelectedNoteToTask={canConvertSelectedNoteToTask}
        isConvertSelectedNoteToTaskDisabled={isConvertSelectedNoteToTaskDisabled}
        convertSelectedNoteToTask={convertSelectedNoteToTask}
      />

      <WorkspaceSpaceActionMenu
        menu={spaceActionMenu}
        availableOpeners={availablePathOpeners}
        canCreateWorktree={activeMenuSpace !== null && isActiveMenuSpaceOnWorkspaceRoot}
        canArchive={activeMenuSpace !== null}
        closeMenu={closeSpaceActionMenu}
        onCreateWorktree={() => {
          if (activeMenuSpace) {
            openSpaceCreateWorktree(activeMenuSpace.id)
          }
        }}
        onArchive={() => {
          if (activeMenuSpace) {
            openSpaceArchive(activeMenuSpace.id)
          }
        }}
        onCopyPath={() => {
          if (activeMenuSpace) {
            return copySpacePath(activeMenuSpace.id)
          }
        }}
        onOpenPath={openerId => {
          if (activeMenuSpace) {
            return openSpacePath(activeMenuSpace.id, openerId)
          }
        }}
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

      <NodeDeleteConfirmationWindow
        nodeDeleteConfirmation={nodeDeleteConfirmation}
        setNodeDeleteConfirmation={setNodeDeleteConfirmation}
        confirmNodeDelete={confirmNodeDelete}
      />

      <SpaceWorktreeMismatchDropWarningWindow
        warning={spaceWorktreeMismatchDropWarning}
        onCancel={cancelSpaceWorktreeMismatchDropWarning}
        onContinue={continueSpaceWorktreeMismatchDropWarning}
      />

      <SpaceWorktreeWindow
        spaceId={spaceWorktreeDialog?.spaceId ?? null}
        initialViewMode={spaceWorktreeDialog?.initialViewMode ?? 'create'}
        spaces={spaces}
        nodes={nodes}
        workspacePath={workspacePath}
        worktreesRoot={worktreesRoot}
        agentSettings={agentSettings}
        onClose={closeSpaceWorktree}
        onShowMessage={onShowMessage}
        onUpdateSpaceDirectory={(spaceId, directoryPath, options) => {
          updateSpaceDirectory(spaceId, directoryPath, options)
        }}
        getBlockingNodes={spaceId => getSpaceBlockingNodes(spaceId)}
        closeNodesById={nodeIds => closeNodesById(nodeIds)}
      />
    </div>
  )
}
function normalizeComparablePath(pathValue: string): string {
  return pathValue.trim().replace(/[\\/]+$/, '')
}
