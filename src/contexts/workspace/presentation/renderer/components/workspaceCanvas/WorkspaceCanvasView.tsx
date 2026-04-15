import React from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  PanOnScrollMode,
  ReactFlow,
  SelectionMode,
  useStore,
  useStoreApi,
  type Edge,
  type Node,
} from '@xyflow/react'
import type { TerminalNodeData } from '../../types'
import { MAX_CANVAS_ZOOM, MIN_CANVAS_ZOOM } from './constants'
import type { WorkspaceCanvasViewProps } from './WorkspaceCanvasView.types'
import { useWorkspaceCanvasGlobalDismissals } from './hooks/useGlobalDismissals'
import { useWorkspaceCanvasSpaceMenuState } from './hooks/useCanvasSpaceMenuState'
import { useWorkspaceCanvasLabelColorFilter } from './hooks/useLabelColorFilter'
import { WorkspaceCanvasWindows } from './view/WorkspaceCanvasWindows'
import { WorkspaceContextMenu } from './view/WorkspaceContextMenu'
import { WorkspaceMinimapDock } from './view/WorkspaceMinimapDock'
import { WorkspaceSelectionDraftOverlay } from './view/WorkspaceSelectionDraftOverlay'
import { WorkspaceSnapGuidesOverlay } from './view/WorkspaceSnapGuidesOverlay'
import { WorkspaceCanvasTopOverlays } from './view/WorkspaceCanvasTopOverlays'
import { WorkspaceSpaceActionMenu } from './view/WorkspaceSpaceActionMenu'
import { WorkspaceSpaceExplorerOverlay } from './view/WorkspaceSpaceExplorerOverlay'
import { WorkspaceSpaceQuickPreview } from './view/WorkspaceSpaceQuickPreview'
import { WorkspaceSpaceRegionsOverlay } from './view/WorkspaceSpaceRegionsOverlay'
import { isEditableDomTarget } from './domTargets'
import { selectDragSurfaceSelectionMode } from '../terminalNode/reactFlowState'

const WHEEL_BLOCK_SELECTOR =
  '.cove-window, .cove-window-backdrop, .workspace-context-menu, .workspace-space-explorer, .workspace-space-quick-preview'

export function WorkspaceCanvasView({
  canvasRef,
  resolvedCanvasInputMode,
  onCanvasClick,
  handleCanvasPointerDownCapture,
  handleCanvasPointerMoveCapture,
  handleCanvasPointerUpCapture,
  handleCanvasDoubleClickCapture,
  handleCanvasWheelCapture,
  handleCanvasPaste,
  handleCanvasDragOver,
  handleCanvasDrop,
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
  snapGuides,
  spaceVisuals,
  spaceFramePreview,
  selectedSpaceIds,
  openExplorerSpaceId,
  explorerClipboard,
  quickPreview,
  toggleSpaceExplorer,
  closeSpaceExplorer,
  setExplorerClipboard,
  findBlockingOpenDocument,
  previewFileInSpace,
  openFileInSpace,
  dismissQuickPreview,
  materializeQuickPreview,
  beginQuickPreviewDrag,
  handleSpaceDragHandlePointerDown,
  editingSpaceId,
  spaceRenameInputRef,
  spaceRenameDraft,
  setSpaceRenameDraft,
  commitSpaceRename,
  cancelSpaceRename,
  startSpaceRename,
  setSpaceLabelColor,
  selectedNodeCount,
  isMinimapVisible,
  minimapNodeColor,
  setIsMinimapVisible,
  onMinimapVisibilityChange,
  spaces,
  activateSpace,
  activateAllSpaces,
  contextMenu,
  closeContextMenu,
  magneticSnappingEnabled,
  onToggleMagneticSnapping,
  createTerminalNode,
  createNoteNodeFromContextMenu,
  createWebsiteNodeFromContextMenu,
  arrangeAll,
  arrangeCanvas,
  arrangeInSpace,
  openTaskCreator,
  openAgentLauncher,
  openAgentLauncherForProvider,
  runQuickCommand,
  insertQuickPhrase,
  openQuickMenuSettings,
  createSpaceFromSelectedNodes,
  spaceTargetMountPicker,
  setSpaceTargetMountPicker,
  confirmSpaceTargetMountPicker,
  cancelSpaceTargetMountPicker,
  clearNodeSelection,
  canConvertSelectedNoteToTask,
  isConvertSelectedNoteToTaskDisabled,
  convertSelectedNoteToTask,
  setSelectedNodeLabelColorOverride,
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
  onAppendSpaceArchiveRecord,
  updateSpaceDirectory,
  getSpaceBlockingNodes,
  closeNodesById,
}: WorkspaceCanvasViewProps): React.JSX.Element {
  const reactFlowStore = useStoreApi()
  const isDragSurfaceSelectionMode = useStore(selectDragSurfaceSelectionMode)
  const { labelColorFilter, setLabelColorFilter, usedLabelColors, filteredNodes, filteredEdges } =
    useWorkspaceCanvasLabelColorFilter({ nodes, edges, spaces })

  useWorkspaceCanvasGlobalDismissals({
    contextMenu,
    spaceActionMenu,
    closeContextMenu,
    canvasRef,
    selectedNodeCount,
    clearNodeSelection,
  })

  const {
    activeMenuSpace,
    isActiveMenuSpaceOnWorkspaceRoot,
    canArrangeCanvas,
    canArrangeAll,
    canArrangeActiveSpace,
  } = useWorkspaceCanvasSpaceMenuState({
    spaceActionMenu,
    spaces,
    workspacePath,
    nodes,
  })

  const activeExplorerSpace = React.useMemo(() => {
    if (!openExplorerSpaceId) {
      return null
    }

    return spaces.find(space => space.id === openExplorerSpaceId) ?? null
  }, [openExplorerSpaceId, spaces])

  React.useEffect(() => {
    if (!useManualCanvasWheelGestures) {
      return
    }

    const canvasElement = canvasRef.current
    if (!canvasElement) {
      return
    }

    const handleWheel = (event: WheelEvent): void => {
      if (event.target instanceof Element && event.target.closest(WHEEL_BLOCK_SELECTOR)) {
        return
      }

      handleCanvasWheelCapture(event)
    }

    const wheelListenerOptions = { passive: false, capture: true } as const
    canvasElement.addEventListener('wheel', handleWheel, wheelListenerOptions)

    return () => {
      canvasElement.removeEventListener('wheel', handleWheel, true)
    }
  }, [canvasRef, handleCanvasWheelCapture, useManualCanvasWheelGestures])

  return (
    <div
      ref={canvasRef}
      className="workspace-canvas"
      data-canvas-input-mode={resolvedCanvasInputMode}
      data-selected-node-count={selectedNodeCount}
      data-cove-drag-surface-selection-mode={isDragSurfaceSelectionMode ? 'true' : 'false'}
      tabIndex={-1}
      onClick={onCanvasClick}
      onPaste={handleCanvasPaste}
      onDragOver={handleCanvasDragOver}
      onDrop={handleCanvasDrop}
      onDoubleClickCapture={handleCanvasDoubleClickCapture}
      onPointerDownCapture={event => {
        if (event.button === 0 && !isEditableDomTarget(event.target)) {
          canvasRef.current?.focus?.({ preventScroll: true })
        }

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
    >
      <ReactFlow<Node<TerminalNodeData>, Edge>
        nodes={filteredNodes}
        edges={filteredEdges}
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
          openExplorerSpaceId={openExplorerSpaceId}
          toggleExplorer={toggleSpaceExplorer}
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

      {activeExplorerSpace && activeExplorerSpace.rect ? (
        <WorkspaceSpaceExplorerOverlay
          canvasRef={canvasRef}
          spaceId={activeExplorerSpace.id}
          spaceName={activeExplorerSpace.name}
          targetMountId={activeExplorerSpace.targetMountId ?? null}
          directoryPath={
            activeExplorerSpace.directoryPath.trim().length > 0
              ? activeExplorerSpace.directoryPath
              : workspacePath
          }
          rect={activeExplorerSpace.rect}
          explorerClipboard={explorerClipboard}
          setExplorerClipboard={setExplorerClipboard}
          findBlockingOpenDocument={findBlockingOpenDocument}
          onShowMessage={onShowMessage}
          onClose={closeSpaceExplorer}
          onPreviewFile={(uri, options) => {
            previewFileInSpace(activeExplorerSpace.id, uri, options)
          }}
          onOpenFile={(uri, options) => {
            openFileInSpace(activeExplorerSpace.id, uri, options)
          }}
          onDismissQuickPreview={dismissQuickPreview}
        />
      ) : null}

      <WorkspaceSpaceQuickPreview
        preview={quickPreview}
        onOpen={materializeQuickPreview}
        onDragStart={beginQuickPreviewDrag}
      />

      <WorkspaceSnapGuidesOverlay guides={snapGuides} />
      <WorkspaceSelectionDraftOverlay canvasRef={canvasRef} draft={selectionDraft} />

      <WorkspaceCanvasTopOverlays
        spaces={spaces}
        activateSpace={activateSpace}
        activateAllSpaces={activateAllSpaces}
        cancelSpaceRename={cancelSpaceRename}
        usedLabelColors={usedLabelColors}
        activeLabelColorFilter={labelColorFilter}
        onToggleLabelColorFilter={color => {
          closeContextMenu()
          closeSpaceActionMenu()
          clearNodeSelection()
          setLabelColorFilter(previous => (previous === color ? null : color))
        }}
        selectedNodeCount={selectedNodeCount}
      />

      <WorkspaceContextMenu
        contextMenu={contextMenu}
        closeContextMenu={closeContextMenu}
        createTerminalNode={createTerminalNode}
        createNoteNodeFromContextMenu={createNoteNodeFromContextMenu}
        createWebsiteNodeFromContextMenu={createWebsiteNodeFromContextMenu}
        websiteWindowsEnabled={agentSettings.websiteWindowPolicy.enabled}
        openTaskCreator={openTaskCreator}
        openAgentLauncher={openAgentLauncher}
        agentProviderOrder={agentSettings.agentProviderOrder}
        openAgentLauncherForProvider={openAgentLauncherForProvider}
        quickCommands={agentSettings.quickCommands}
        quickPhrases={agentSettings.quickPhrases}
        runQuickCommand={runQuickCommand}
        insertQuickPhrase={insertQuickPhrase}
        openQuickMenuSettings={openQuickMenuSettings}
        spaces={spaces}
        magneticSnappingEnabled={magneticSnappingEnabled}
        onToggleMagneticSnapping={onToggleMagneticSnapping}
        canArrangeAll={canArrangeAll}
        canArrangeCanvas={canArrangeCanvas}
        arrangeAll={arrangeAll}
        arrangeCanvas={arrangeCanvas}
        arrangeInSpace={arrangeInSpace}
        createSpaceFromSelectedNodes={createSpaceFromSelectedNodes}
        clearNodeSelection={clearNodeSelection}
        canConvertSelectedNoteToTask={canConvertSelectedNoteToTask}
        isConvertSelectedNoteToTaskDisabled={isConvertSelectedNoteToTaskDisabled}
        convertSelectedNoteToTask={convertSelectedNoteToTask}
        setSelectedNodeLabelColorOverride={setSelectedNodeLabelColorOverride}
      />

      <WorkspaceSpaceActionMenu
        menu={spaceActionMenu}
        availableOpeners={availablePathOpeners}
        canArrange={canArrangeActiveSpace}
        canCreateWorktree={activeMenuSpace !== null && isActiveMenuSpaceOnWorkspaceRoot}
        canArchive={activeMenuSpace !== null}
        closeMenu={closeSpaceActionMenu}
        setSpaceLabelColor={setSpaceLabelColor}
        onArrange={arrangeInSpace}
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

      <WorkspaceCanvasWindows
        taskCreator={taskCreator}
        taskTitleProviderLabel={taskTitleProviderLabel}
        taskTitleModelLabel={taskTitleModelLabel}
        taskTagOptions={taskTagOptions}
        setTaskCreator={setTaskCreator}
        closeTaskCreator={closeTaskCreator}
        generateTaskTitle={generateTaskTitle}
        createTask={createTask}
        taskEditor={taskEditor}
        setTaskEditor={setTaskEditor}
        closeTaskEditor={closeTaskEditor}
        generateTaskEditorTitle={generateTaskEditorTitle}
        saveTaskEdits={saveTaskEdits}
        spaceTargetMountPicker={spaceTargetMountPicker}
        setSpaceTargetMountPicker={setSpaceTargetMountPicker}
        confirmSpaceTargetMountPicker={confirmSpaceTargetMountPicker}
        cancelSpaceTargetMountPicker={cancelSpaceTargetMountPicker}
        nodeDeleteConfirmation={nodeDeleteConfirmation}
        setNodeDeleteConfirmation={setNodeDeleteConfirmation}
        confirmNodeDelete={confirmNodeDelete}
        spaceWorktreeMismatchDropWarning={spaceWorktreeMismatchDropWarning}
        cancelSpaceWorktreeMismatchDropWarning={cancelSpaceWorktreeMismatchDropWarning}
        continueSpaceWorktreeMismatchDropWarning={continueSpaceWorktreeMismatchDropWarning}
        spaceWorktreeDialog={spaceWorktreeDialog}
        spaces={spaces}
        nodes={nodes}
        workspacePath={workspacePath}
        worktreesRoot={worktreesRoot}
        agentSettings={agentSettings}
        closeSpaceWorktree={closeSpaceWorktree}
        onShowMessage={onShowMessage}
        onAppendSpaceArchiveRecord={onAppendSpaceArchiveRecord}
        updateSpaceDirectory={updateSpaceDirectory}
        getSpaceBlockingNodes={getSpaceBlockingNodes}
        closeNodesById={closeNodesById}
      />
    </div>
  )
}
