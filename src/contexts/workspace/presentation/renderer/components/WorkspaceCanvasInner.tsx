import React from 'react'
import { useReactFlow, type Edge, type Node } from '@xyflow/react'
import type { TerminalNodeData } from '../types'
import * as workspaceCanvasHooks from './workspaceCanvas/hooks'
import { WorkspaceCanvasView } from './workspaceCanvas/WorkspaceCanvasView'
import type { WorkspaceCanvasProps } from './workspaceCanvas/types'
export function WorkspaceCanvasInner({
  workspaceId,
  onShowMessage,
  workspacePath,
  worktreesRoot,
  nodes,
  onNodesChange,
  onRequestPersistFlush,
  spaces,
  activeSpaceId,
  onSpacesChange,
  onActiveSpaceChange,
  shortcutsEnabled = true,
  viewport,
  isMinimapVisible: persistedMinimapVisible,
  onViewportChange,
  onMinimapVisibilityChange,
  agentSettings,
  isFocusNodeTargetZoomPreviewing = false,
  focusNodeId,
  focusSequence,
}: WorkspaceCanvasProps): React.JSX.Element {
  const reactFlow = useReactFlow<Node<TerminalNodeData>, Edge>()
  const canvasState = workspaceCanvasHooks.useWorkspaceCanvasState({
    nodes,
    spaces,
    viewport,
    persistedMinimapVisible,
  })
  const exclusiveNodeDragAnchorIdRef =
    workspaceCanvasHooks.useWorkspaceCanvasWorkspaceReset(workspaceId)
  const actionRefs = workspaceCanvasHooks.useWorkspaceCanvasActionRefs()
  const idsRef = canvasState.selectedNodeIdsRef
  const {
    nodesRef,
    isNodeDraggingRef,
    setNodes,
    bumpAgentLaunchToken,
    clearAgentLaunchToken,
    isAgentLaunchTokenCurrent,
    closeNode,
    normalizePosition,
    resizeNode,
    applyPendingScrollbacks,
    updateNodeScrollback,
    updateTerminalTitle,
    renameTerminalTitle,
    setNodeLabelColorOverride: setLabelColor,
    updateNoteText,
    createNodeForSession,
    createNoteNode,
    createTaskNode,
    createImageNode,
  } = workspaceCanvasHooks.useWorkspaceCanvasNodesStore({
    nodes: canvasState.flowNodes,
    spacesRef: canvasState.spacesRef,
    onNodesChange,
    onSpacesChange,
    onRequestPersistFlush,
    onShowMessage,
    standardWindowSizeBucket: agentSettings.standardWindowSizeBucket,
  })
  const { updateSpaceDirectory, getSpaceBlockingNodes, closeNodesById } =
    workspaceCanvasHooks.useWorkspaceCanvasSpaceDirectoryOps({
      workspacePath,
      spacesRef: canvasState.spacesRef,
      nodesRef,
      setNodes,
      onSpacesChange,
      onRequestPersistFlush,
      closeNode,
    })
  const {
    editingSpaceId,
    spaceRenameDraft,
    setSpaceRenameDraft,
    spaceRenameInputRef,
    startSpaceRename,
    cancelSpaceRename,
    commitSpaceRename,
    setSpaceLabelColor,
    createSpaceFromSelectedNodes,
    spaceVisuals,
    activateSpace,
    activateAllSpaces,
  } = workspaceCanvasHooks.useWorkspaceCanvasSpaces({
    workspaceId,
    activeSpaceId,
    onActiveSpaceChange,
    workspacePath,
    reactFlow,
    nodes: canvasState.flowNodes,
    nodesRef,
    setNodes,
    spaces,
    spacesRef: canvasState.spacesRef,
    selectedNodeIds: canvasState.selectedNodeIds,
    selectedNodeIdsRef: canvasState.selectedNodeIdsRef,
    onSpacesChange,
    onRequestPersistFlush,
    setContextMenu: canvasState.setContextMenu,
    setEmptySelectionPrompt: canvasState.setEmptySelectionPrompt,
    onShowMessage,
  })
  const { spaceFramePreview, handleSpaceDragHandlePointerDown } =
    workspaceCanvasHooks.useWorkspaceCanvasSpaceDrag({
      workspaceId,
      reactFlow,
      nodesRef,
      spacesRef: canvasState.spacesRef,
      selectedNodeIdsRef: canvasState.selectedNodeIdsRef,
      selectedSpaceIdsRef: canvasState.selectedSpaceIdsRef,
      setNodes,
      onSpacesChange,
      setSelectedNodeIds: canvasState.setSelectedNodeIds,
      setSelectedSpaceIds: canvasState.setSelectedSpaceIds,
      magneticSnappingEnabledRef: canvasState.magneticSnappingEnabledRef,
      setSnapGuides: canvasState.setSnapGuides,
      onRequestPersistFlush,
      setContextMenu: canvasState.setContextMenu,
      cancelSpaceRename,
      setEmptySelectionPrompt: canvasState.setEmptySelectionPrompt,
    })
  const {
    handleNodeDragStart,
    handleSelectionDragStart,
    handleNodeDragStop,
    handleSelectionDragStop,
    spaceWorktreeMismatchDropWarning,
    cancelSpaceWorktreeMismatchDropWarning,
    continueSpaceWorktreeMismatchDropWarning,
  } = workspaceCanvasHooks.useWorkspaceCanvasSpaceOwnership({
    workspacePath,
    reactFlow,
    spacesRef: canvasState.spacesRef,
    selectedNodeIdsRef: canvasState.selectedNodeIdsRef,
    setSelectedNodeIds: canvasState.setSelectedNodeIds,
    selectedSpaceIdsRef: canvasState.selectedSpaceIdsRef,
    setSelectedSpaceIds: canvasState.setSelectedSpaceIds,
    dragSelectedSpaceIdsRef: canvasState.dragSelectedSpaceIdsRef,
    exclusiveNodeDragAnchorIdRef,
    setNodes,
    onSpacesChange,
    onRequestPersistFlush,
    onShowMessage,
    hideWorktreeMismatchDropWarning: agentSettings.hideWorktreeMismatchDropWarning === true,
  })
  const {
    buildAgentNodeTitle,
    launchAgentInNode,
    openAgentLauncher,
    openAgentLauncherForProvider,
  } = workspaceCanvasHooks.useWorkspaceCanvasAgentSupport({
    nodesRef,
    setNodes,
    bumpAgentLaunchToken,
    isAgentLaunchTokenCurrent,
    agentSettings,
    workspacePath,
    spacesRef: canvasState.spacesRef,
    onSpacesChange,
    onRequestPersistFlush,
    onShowMessage,
    contextMenu: canvasState.contextMenu,
    setContextMenu: canvasState.setContextMenu,
    createNodeForSession,
    standardWindowSizeBucket: agentSettings.standardWindowSizeBucket,
  })
  const {
    taskTagOptions,
    taskCreator,
    setTaskCreator,
    openTaskCreator,
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
    requestNodeClose,
  } = workspaceCanvasHooks.useWorkspaceCanvasTaskUi({
    agentTaskTagOptions: agentSettings.taskTagOptions,
    contextMenu: canvasState.contextMenu,
    setContextMenu: canvasState.setContextMenu,
    nodesRef,
    setNodes,
    spacesRef: canvasState.spacesRef,
    onSpacesChange,
    onRequestPersistFlush,
    createNodeForSession,
    buildAgentNodeTitle,
    launchAgentInNode,
    agentSettings,
    workspacePath,
    standardWindowSizeBucket: agentSettings.standardWindowSizeBucket,
    createTaskNode,
    closeNode,
    actionRefs,
  })
  const {
    resolvedCanvasInputMode,
    isTrackpadCanvasMode,
    useManualCanvasWheelGestures,
    handleCanvasWheelCapture,
  } = workspaceCanvasHooks.useWorkspaceCanvasInputMode({
    canvasInputModeSetting: agentSettings.canvasInputMode,
    detectedCanvasInputMode: canvasState.detectedCanvasInputMode,
    inputModalityStateRef: canvasState.inputModalityStateRef,
    setDetectedCanvasInputMode: canvasState.setDetectedCanvasInputMode,
    canvasRef: canvasState.canvasRef,
    trackpadGestureLockRef: canvasState.trackpadGestureLockRef,
    viewportRef: canvasState.viewportRef,
    reactFlow,
    onViewportChange,
  })
  workspaceCanvasHooks.useWorkspaceCanvasLifecycleBindings({
    workspaceId,
    persistedMinimapVisible,
    canvasState,
    cancelSpaceRename,
    reactFlow,
    viewport,
    agentSettings,
    focusNodeId,
    focusSequence,
    isFocusNodeTargetZoomPreviewing,
    nodesRef,
    requestNodeDeleteRef: actionRefs.requestNodeDeleteRef,
  })
  const nodeTypes = workspaceCanvasHooks.useWorkspaceCanvasComposedNodeTypes({
    setNodes,
    setSelectedNodeIds: canvasState.setSelectedNodeIds,
    setSelectedSpaceIds: canvasState.setSelectedSpaceIds,
    selectedNodeIdsRef: canvasState.selectedNodeIdsRef,
    selectedSpaceIdsRef: canvasState.selectedSpaceIdsRef,
    spacesRef: canvasState.spacesRef,
    workspacePath,
    agentSettings,
    actionRefs,
  })
  const {
    clearNodeSelection,
    handleNodeClick,
    handleSelectionContextMenu,
    handleNodeContextMenu,
    handlePaneContextMenu,
    handleSelectionChange,
    handleCanvasPointerDownCapture,
    handleCanvasPointerMoveCapture,
    handleCanvasPointerUpCapture,
    handleCanvasDoubleClickCapture,
    handlePaneClick,
    createTerminalNode,
    createNoteNodeFromContextMenu,
    handleCanvasPaste,
    handleCanvasDragOver,
    handleCanvasDrop,
  } = workspaceCanvasHooks.useWorkspaceCanvasInteractions({
    canvasRef: canvasState.canvasRef,
    isTrackpadCanvasMode,
    focusNodeOnClick: agentSettings.focusNodeOnClick,
    focusNodeTargetZoom: agentSettings.focusNodeTargetZoom,
    isShiftPressedRef: canvasState.isShiftPressedRef,
    selectionDraftRef: canvasState.selectionDraftRef,
    setSelectionDraftUi: canvasState.setSelectionDraftUi,
    reactFlow,
    setNodes,
    setSelectedNodeIds: canvasState.setSelectedNodeIds,
    setSelectedSpaceIds: canvasState.setSelectedSpaceIds,
    setContextMenu: canvasState.setContextMenu,
    setEmptySelectionPrompt: canvasState.setEmptySelectionPrompt,
    cancelSpaceRename,
    selectedNodeIdsRef: canvasState.selectedNodeIdsRef,
    selectedSpaceIdsRef: canvasState.selectedSpaceIdsRef,
    contextMenu: canvasState.contextMenu,
    workspacePath,
    defaultTerminalProfileId: agentSettings.defaultTerminalProfileId,
    spacesRef: canvasState.spacesRef,
    onSpacesChange,
    nodesRef,
    standardWindowSizeBucket: agentSettings.standardWindowSizeBucket,
    createNodeForSession,
    createNoteNode,
    onShowMessage,
    createImageNode,
  })
  workspaceCanvasHooks.useWorkspaceCanvasShortcutActions({
    enabled: shortcutsEnabled,
    activeSpaceId,
    spaces,
    agentSettings,
    workspacePath,
    canvasRef: canvasState.canvasRef,
    setContextMenu: canvasState.setContextMenu,
    setEmptySelectionPrompt: canvasState.setEmptySelectionPrompt,
    cancelSpaceRename,
    reactFlow,
    spacesRef: canvasState.spacesRef,
    nodesRef,
    setNodes,
    onSpacesChange,
    createNodeForSession,
    createNoteNode,
    createSpaceFromSelectedNodes,
    activateSpace,
  })
  const {
    canConvertSelectedNoteToTask,
    isConvertSelectedNoteToTaskDisabled,
    convertSelectedNoteToTask,
    arrangeAll,
    arrangeCanvas,
    arrangeInSpace,
  } = workspaceCanvasHooks.useWorkspaceCanvasMenuActions({
    selectedNodeIds: canvasState.selectedNodeIds,
    selectedNodeIdsRef: canvasState.selectedNodeIdsRef,
    flowNodes: canvasState.flowNodes,
    nodesRef,
    setNodes,
    onRequestPersistFlush,
    onShowMessage,
    setContextMenu: canvasState.setContextMenu,
    reactFlow,
    spacesRef: canvasState.spacesRef,
    onSpacesChange,
    standardWindowSizeBucket: agentSettings.standardWindowSizeBucket,
  })
  workspaceCanvasHooks.useWorkspaceCanvasRuntimeBindings({
    setNodes,
    onRequestPersistFlush,
    actionRefs,
    clearNodeSelection,
    closeNode: requestNodeClose,
    resizeNode,
    updateNoteText,
    updateNodeScrollback,
    updateTerminalTitle,
    renameTerminalTitle,
    focusNodeOnClick: agentSettings.focusNodeOnClick,
    focusNodeTargetZoom: agentSettings.focusNodeTargetZoom,
    nodesRef,
    reactFlow,
    onShowMessage,
  })
  const applyChanges = workspaceCanvasHooks.useWorkspaceCanvasApplyNodeChanges({
    nodesRef,
    onNodesChange,
    clearAgentLaunchToken,
    normalizePosition,
    applyPendingScrollbacks,
    isNodeDraggingRef,
    spacesRef: canvasState.spacesRef,
    selectedSpaceIdsRef: canvasState.selectedSpaceIdsRef,
    dragSelectedSpaceIdsRef: canvasState.dragSelectedSpaceIdsRef,
    magneticSnappingEnabledRef: canvasState.magneticSnappingEnabledRef,
    setSnapGuides: canvasState.setSnapGuides,
    exclusiveNodeDragAnchorIdRef,
    onSpacesChange,
    onRequestPersistFlush,
  })
  const {
    taskTitleProviderLabel,
    taskTitleModelLabel,
    handleViewportMoveEnd,
    minimapNodeColor,
    taskAgentEdges,
    spaceUi,
  } = workspaceCanvasHooks.useWorkspaceCanvasViewModel({
    agentSettings,
    viewportRef: canvasState.viewportRef,
    onViewportChange,
    flowNodes: canvasState.flowNodes,
    contextMenu: canvasState.contextMenu,
    setContextMenu: canvasState.setContextMenu,
    setEmptySelectionPrompt: canvasState.setEmptySelectionPrompt,
    cancelSpaceRename,
    workspacePath,
    spacesRef: canvasState.spacesRef,
    handlePaneClick,
    handlePaneContextMenu,
    handleNodeContextMenu,
    handleSelectionContextMenu,
  })
  return (
    <WorkspaceCanvasView
      canvasRef={canvasState.canvasRef}
      resolvedCanvasInputMode={resolvedCanvasInputMode}
      onCanvasClick={spaceUi.handleCanvasClick}
      handleCanvasPointerDownCapture={handleCanvasPointerDownCapture}
      handleCanvasPointerMoveCapture={handleCanvasPointerMoveCapture}
      handleCanvasPointerUpCapture={handleCanvasPointerUpCapture}
      handleCanvasDoubleClickCapture={handleCanvasDoubleClickCapture}
      handleCanvasWheelCapture={handleCanvasWheelCapture}
      handleCanvasPaste={handleCanvasPaste}
      handleCanvasDragOver={handleCanvasDragOver}
      handleCanvasDrop={handleCanvasDrop}
      nodes={canvasState.flowNodes}
      edges={taskAgentEdges}
      nodeTypes={nodeTypes}
      onNodesChange={applyChanges}
      onPaneClick={spaceUi.handlePaneClickWithSpaceMenuClose}
      onPaneContextMenu={spaceUi.handlePaneContextMenuWithSpaceMenuClose}
      onNodeClick={handleNodeClick}
      onNodeContextMenu={spaceUi.handleNodeContextMenuWithSpaceMenuClose}
      onSelectionContextMenu={spaceUi.handleSelectionContextMenuWithSpaceMenuClose}
      onSelectionChange={handleSelectionChange}
      onNodeDragStart={handleNodeDragStart}
      onSelectionDragStart={handleSelectionDragStart}
      onNodeDragStop={handleNodeDragStop}
      onSelectionDragStop={handleSelectionDragStop}
      onMoveEnd={handleViewportMoveEnd}
      viewport={viewport}
      isTrackpadCanvasMode={isTrackpadCanvasMode}
      useManualCanvasWheelGestures={useManualCanvasWheelGestures}
      isShiftPressed={canvasState.isShiftPressed}
      selectionDraft={canvasState.selectionDraftUi}
      snapGuides={canvasState.snapGuides}
      spaceVisuals={spaceVisuals}
      spaceFramePreview={spaceFramePreview}
      selectedSpaceIds={canvasState.selectedSpaceIds}
      handleSpaceDragHandlePointerDown={handleSpaceDragHandlePointerDown}
      editingSpaceId={editingSpaceId}
      spaceRenameInputRef={spaceRenameInputRef}
      spaceRenameDraft={spaceRenameDraft}
      setSpaceRenameDraft={setSpaceRenameDraft}
      commitSpaceRename={commitSpaceRename}
      cancelSpaceRename={cancelSpaceRename}
      startSpaceRename={startSpaceRename}
      setSpaceLabelColor={setSpaceLabelColor}
      selectedNodeCount={canvasState.selectedNodeIds.length}
      isMinimapVisible={canvasState.isMinimapVisible}
      minimapNodeColor={minimapNodeColor}
      setIsMinimapVisible={canvasState.setIsMinimapVisible}
      onMinimapVisibilityChange={onMinimapVisibilityChange}
      spaces={spaces}
      activateSpace={activateSpace}
      activateAllSpaces={activateAllSpaces}
      contextMenu={canvasState.contextMenu}
      closeContextMenu={spaceUi.closeContextMenu}
      magneticSnappingEnabled={canvasState.magneticSnappingEnabled}
      onToggleMagneticSnapping={() => canvasState.setMagneticSnappingEnabled(enabled => !enabled)}
      createTerminalNode={createTerminalNode}
      createNoteNodeFromContextMenu={createNoteNodeFromContextMenu}
      arrangeAll={arrangeAll}
      arrangeCanvas={arrangeCanvas}
      arrangeInSpace={arrangeInSpace}
      openTaskCreator={openTaskCreator}
      openAgentLauncher={openAgentLauncher}
      openAgentLauncherForProvider={openAgentLauncherForProvider}
      createSpaceFromSelectedNodes={createSpaceFromSelectedNodes}
      clearNodeSelection={clearNodeSelection}
      canConvertSelectedNoteToTask={canConvertSelectedNoteToTask}
      isConvertSelectedNoteToTaskDisabled={isConvertSelectedNoteToTaskDisabled}
      convertSelectedNoteToTask={convertSelectedNoteToTask}
      setSelectedNodeLabelColorOverride={override => setLabelColor(idsRef.current, override)}
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
      nodeDeleteConfirmation={nodeDeleteConfirmation}
      setNodeDeleteConfirmation={setNodeDeleteConfirmation}
      confirmNodeDelete={confirmNodeDelete}
      spaceWorktreeMismatchDropWarning={spaceWorktreeMismatchDropWarning}
      cancelSpaceWorktreeMismatchDropWarning={cancelSpaceWorktreeMismatchDropWarning}
      continueSpaceWorktreeMismatchDropWarning={continueSpaceWorktreeMismatchDropWarning}
      agentSettings={agentSettings}
      workspacePath={workspacePath}
      spaceActionMenu={spaceUi.spaceActionMenu}
      availablePathOpeners={spaceUi.availablePathOpeners}
      openSpaceActionMenu={spaceUi.openSpaceActionMenu}
      closeSpaceActionMenu={spaceUi.closeSpaceActionMenu}
      copySpacePath={spaceUi.copySpacePath}
      openSpacePath={spaceUi.openSpacePath}
      spaceWorktreeDialog={spaceUi.spaceWorktreeDialog}
      worktreesRoot={worktreesRoot}
      openSpaceCreateWorktree={spaceUi.openSpaceCreateWorktree}
      openSpaceArchive={spaceUi.openSpaceArchive}
      closeSpaceWorktree={spaceUi.closeSpaceWorktree}
      onShowMessage={onShowMessage}
      updateSpaceDirectory={updateSpaceDirectory}
      getSpaceBlockingNodes={getSpaceBlockingNodes}
      closeNodesById={closeNodesById}
    />
  )
}
