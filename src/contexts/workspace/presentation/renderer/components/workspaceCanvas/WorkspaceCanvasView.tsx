import React from 'react'
import {
  PanOnScrollMode,
  ReactFlow,
  SelectionMode,
  useStore,
  useStoreApi,
  type Edge,
  type Node,
} from '@xyflow/react'
import type { TerminalNodeData } from '../../types'
import { WorkspaceCanvasControls } from './collapse/WorkspaceCanvasControls'
import { MAX_CANVAS_ZOOM, MIN_CANVAS_ZOOM } from './constants'
import type { WorkspaceCanvasViewProps } from './WorkspaceCanvasView.types'
import { useActiveExplorerSpace } from './hooks/useActiveExplorerSpace'
import { useWorkspaceCanvasGlobalDismissals } from './hooks/useGlobalDismissals'
import { useWorkspaceCanvasSpaceMenuState } from './hooks/useCanvasSpaceMenuState'
import { useWorkspaceCanvasLabelColorFilter } from './hooks/useLabelColorFilter'
import { useViewportDprSnapping } from './hooks/useViewportDprSnapping'
import { useSpaceWorktreeBusyLabels } from './hooks/useSpaceWorktreeBusyLabels'
import { WorkspaceCanvasMenus } from './view/WorkspaceCanvasMenus'
import { WorkspaceCanvasBackground } from './view/WorkspaceCanvasBackground'
import { WorkspaceCanvasWindows } from './view/WorkspaceCanvasWindows'
import { WorkspaceMinimapDock } from './view/WorkspaceMinimapDock'
import { WorkspaceSelectionDraftOverlay } from './view/WorkspaceSelectionDraftOverlay'
import { WorkspaceSnapGuidesOverlay } from './view/WorkspaceSnapGuidesOverlay'
import { WorkspaceCanvasTopOverlays } from './view/WorkspaceCanvasTopOverlays'
import { WorkspaceSpaceExplorerOverlay } from './view/WorkspaceSpaceExplorerOverlay'
import { WorkspaceSpaceQuickPreview } from './view/WorkspaceSpaceQuickPreview'
import { WorkspaceSpaceRegionsOverlay } from './view/WorkspaceSpaceRegionsOverlay'
import { WorkspaceCanvasActionBar } from './view/WorkspaceCanvasActionBar'
import { useCanvasViewPointerEvents } from './hooks/useCanvasViewPointerEvents'
import { selectDragSurfaceSelectionMode } from '../terminalNode/reactFlowState'

export function WorkspaceCanvasView({
  workspaceId,
  canvasRef,
  resolvedCanvasInputMode,
  isCanvasWheelGestureCaptureActive,
  onCanvasClick,
  handleCanvasPointerDownCapture,
  handleCanvasPointerMoveCapture,
  handleCanvasPointerUpCapture,
  handleCanvasDoubleClickCapture,
  handleCanvasWheelCapture,
  handleCanvasPaste,
  handleCanvasDragOver,
  handleCanvasDrop,
  createNodeAtViewportCenter,
  createNodeAtPoint,
  clearActionBarTransientUi,
  resolveDropTargetLabel,
  nodes,
  edges,
  nodeTypes,
  onNodesChange,
  onPaneClick,
  onPaneContextMenu,
  onNodeClick,
  onNodeContextMenu,
  onSelectionContextMenu,
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
  onOpenSpaceContextMenu,
  contextMenu,
  closeContextMenu,
  magneticSnappingEnabled,
  onToggleMagneticSnapping,
  createTerminalNode,
  createNoteNodeFromContextMenu,
  createWebsiteNodeFromContextMenu,
  createPluginNodeFromContextMenu,
  arrangeAll,
  arrangeCanvas,
  arrangeInSpace,
  openTaskCreator,
  openRoleCreator,
  openAgentLauncher,
  openAgentLauncherForProvider,
  projectRoles,
  runProjectRoleFromContextMenu,
  openRoleEditor,
  deleteProjectRole,
  runQuickCommand,
  insertQuickPhrase,
  openQuickMenuSettings,
  createSpaceFromSelectedNodes,
  createChildSpaceInParent,
  createEmptySpaceAtPoint,
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
  roleCreator,
  setRoleCreator,
  closeRoleCreator,
  createRole,
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
  onChangePreserveWindowSizesOnArrange,
  workspacePath,
  spaceActionMenu,
  availablePathOpeners,
  openSpaceActionMenu,
  closeSpaceActionMenu,
  copySpacePath,
  openSpacePath,
  spaceWorktreeOperations,
  worktreesRoot,
  openSpaceCreateWorktree,
  openSpaceArchive,
  closeSpaceWorktree,
  setSpaceWorktreeOperationPhase,
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
  const busyOperationBySpaceId = useSpaceWorktreeBusyLabels(spaceWorktreeOperations)

  useWorkspaceCanvasGlobalDismissals({
    contextMenu,
    spaceActionMenu,
    closeContextMenu,
    canvasRef,
    selectedNodeCount,
    clearNodeSelection,
  })

  const { snapViewport } = useViewportDprSnapping(canvasRef)

  const {
    activeMenuSpace,
    canCreateWorktreeForActiveMenuSpace,
    canArrangeCanvas,
    canArrangeAll,
    canArrangeActiveSpace,
  } = useWorkspaceCanvasSpaceMenuState({
    spaceActionMenu,
    spaces,
    workspacePath,
    nodes,
  })

  const activeExplorerSpace = useActiveExplorerSpace(openExplorerSpaceId, spaces, spaceFramePreview)

  const pointerEvents = useCanvasViewPointerEvents({
    canvasRef,
    contextMenu,
    spaceActionMenu,
    closeContextMenu,
    useManualCanvasWheelGestures,
    handleCanvasWheelCapture,
    handleCanvasPointerDownCapture,
    handleCanvasPointerMoveCapture,
    handleCanvasPointerUpCapture,
  })

  return (
    <div
      ref={canvasRef}
      className="workspace-canvas"
      data-canvas-input-mode={resolvedCanvasInputMode}
      data-cove-wheel-gesture-capture-active={isCanvasWheelGestureCaptureActive ? 'true' : 'false'}
      data-selected-node-count={selectedNodeCount}
      data-cove-drag-surface-selection-mode={isDragSurfaceSelectionMode ? 'true' : 'false'}
      tabIndex={-1}
      onClick={onCanvasClick}
      onPaste={handleCanvasPaste}
      onDragOver={handleCanvasDragOver}
      onDrop={handleCanvasDrop}
      onDoubleClickCapture={handleCanvasDoubleClickCapture}
      {...pointerEvents}
    >
      <ReactFlow<Node<TerminalNodeData>, Edge>
        nodes={filteredNodes}
        edges={filteredEdges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onError={code => {
          // Suppress error015: "drag a node that is not initialized"
          // This fires harmlessly when a node is dragged before its dimensions
          // have been measured by React Flow's internal ResizeObserver.
          if (code === '015') {
            return
          }
          // eslint-disable-next-line no-console
          console.warn(`[React Flow] error ${code}`)
        }}
        onPaneClick={onPaneClick}
        onPaneContextMenu={onPaneContextMenu}
        onNodeClick={onNodeClick}
        onNodeContextMenu={onNodeContextMenu}
        onSelectionContextMenu={onSelectionContextMenu}
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
          snapViewport()
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
        <WorkspaceCanvasBackground
          key={workspaceId}
          settings={agentSettings}
          canvasRef={canvasRef}
          nodes={filteredNodes}
        />
        <WorkspaceSpaceRegionsOverlay
          workspacePath={workspacePath}
          spaceVisuals={spaceVisuals}
          busyOperationBySpaceId={busyOperationBySpaceId}
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
        <WorkspaceCanvasControls />
      </ReactFlow>
      {activeExplorerSpace && activeExplorerSpace.rect ? (
        <WorkspaceSpaceExplorerOverlay
          key={activeExplorerSpace.id}
          spaceId={activeExplorerSpace.id}
          spaceName={activeExplorerSpace.name}
          targetMountId={activeExplorerSpace.targetMountId ?? null}
          directoryPath={
            activeExplorerSpace.directoryPath.trim().length > 0
              ? activeExplorerSpace.directoryPath
              : workspacePath
          }
          rect={activeExplorerSpace.rect}
          agentSettings={agentSettings}
          explorerClipboard={explorerClipboard}
          setExplorerClipboard={setExplorerClipboard}
          findBlockingOpenDocument={findBlockingOpenDocument}
          onShowMessage={onShowMessage}
          onClose={closeSpaceExplorer}
          onPreviewFile={(uri, options) => previewFileInSpace(activeExplorerSpace.id, uri, options)}
          onOpenFile={(uri, options) => openFileInSpace(activeExplorerSpace.id, uri, options)}
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
      <WorkspaceCanvasActionBar
        canvasRef={canvasRef}
        defaultAgentProvider={agentSettings.defaultProvider}
        onCreateAtCenter={createNodeAtViewportCenter}
        onCreateAtPoint={createNodeAtPoint}
        onInteractionStart={clearActionBarTransientUi}
        resolveDropTargetLabel={resolveDropTargetLabel}
      />
      <WorkspaceCanvasTopOverlays
        spaces={spaces}
        activateSpace={activateSpace}
        activateAllSpaces={activateAllSpaces}
        cancelSpaceRename={cancelSpaceRename}
        onOpenSpaceContextMenu={(spaceId, anchor) => {
          closeContextMenu()
          onOpenSpaceContextMenu?.(spaceId, anchor)
        }}
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
      <WorkspaceCanvasMenus
        contextMenu={contextMenu}
        closeContextMenu={closeContextMenu}
        createTerminalNode={createTerminalNode}
        createNoteNodeFromContextMenu={createNoteNodeFromContextMenu}
        createWebsiteNodeFromContextMenu={createWebsiteNodeFromContextMenu}
        createPluginNodeFromContextMenu={createPluginNodeFromContextMenu}
        openTaskCreator={openTaskCreator}
        openRoleCreator={openRoleCreator}
        openAgentLauncher={openAgentLauncher}
        openAgentLauncherForProvider={openAgentLauncherForProvider}
        projectRoles={projectRoles}
        runProjectRoleFromContextMenu={runProjectRoleFromContextMenu}
        openRoleEditor={openRoleEditor}
        deleteProjectRole={deleteProjectRole}
        runQuickCommand={runQuickCommand}
        insertQuickPhrase={insertQuickPhrase}
        openQuickMenuSettings={openQuickMenuSettings}
        spaces={spaces}
        magneticSnappingEnabled={magneticSnappingEnabled}
        onToggleMagneticSnapping={onToggleMagneticSnapping}
        canArrangeAll={canArrangeAll}
        canArrangeCanvas={canArrangeCanvas}
        canArrangeActiveSpace={canArrangeActiveSpace}
        arrangeAll={arrangeAll}
        arrangeCanvas={arrangeCanvas}
        arrangeInSpace={arrangeInSpace}
        createSpaceFromSelectedNodes={createSpaceFromSelectedNodes}
        createChildSpaceInParent={createChildSpaceInParent}
        createEmptySpaceAtPoint={createEmptySpaceAtPoint}
        clearNodeSelection={clearNodeSelection}
        canConvertSelectedNoteToTask={canConvertSelectedNoteToTask}
        isConvertSelectedNoteToTaskDisabled={isConvertSelectedNoteToTaskDisabled}
        convertSelectedNoteToTask={convertSelectedNoteToTask}
        setSelectedNodeLabelColorOverride={setSelectedNodeLabelColorOverride}
        spaceActionMenu={spaceActionMenu}
        availablePathOpeners={availablePathOpeners}
        activeMenuSpace={activeMenuSpace}
        canCreateWorktreeForActiveMenuSpace={canCreateWorktreeForActiveMenuSpace}
        closeSpaceActionMenu={closeSpaceActionMenu}
        setSpaceLabelColor={setSpaceLabelColor}
        openSpaceCreateWorktree={openSpaceCreateWorktree}
        openSpaceArchive={openSpaceArchive}
        copySpacePath={copySpacePath}
        openSpacePath={openSpacePath}
        agentSettings={agentSettings}
        onChangePreserveWindowSizesOnArrange={onChangePreserveWindowSizesOnArrange}
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
        roleCreator={roleCreator}
        setRoleCreator={setRoleCreator}
        closeRoleCreator={closeRoleCreator}
        createRole={createRole}
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
        spaceWorktreeOperations={spaceWorktreeOperations}
        spaces={spaces}
        nodes={nodes}
        workspacePath={workspacePath}
        worktreesRoot={worktreesRoot}
        agentSettings={agentSettings}
        closeSpaceWorktree={closeSpaceWorktree}
        setSpaceWorktreeOperationPhase={setSpaceWorktreeOperationPhase}
        onShowMessage={onShowMessage}
        onAppendSpaceArchiveRecord={onAppendSpaceArchiveRecord}
        updateSpaceDirectory={updateSpaceDirectory}
        getSpaceBlockingNodes={getSpaceBlockingNodes}
        closeNodesById={closeNodesById}
      />
    </div>
  )
}
