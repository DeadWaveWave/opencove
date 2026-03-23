import React, { useLayoutEffect, useRef } from 'react'
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
  workspaceCanvasHooks.useWorkspaceCanvasNodesSelectionActive()
  const exclusiveNodeDragAnchorIdRef = useRef<string | null>(null)

  useLayoutEffect(() => {
    exclusiveNodeDragAnchorIdRef.current = null
  }, [workspaceId])
  const actionRefs = workspaceCanvasHooks.useWorkspaceCanvasActionRefs()
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
    setNodeLabelColorOverride,
    updateNoteText,
    createNodeForSession,
    createNoteNode,
    createTaskNode,
  } = workspaceCanvasHooks.useWorkspaceCanvasNodesStore({
    nodes: canvasState.flowNodes,
    spacesRef: canvasState.spacesRef,
    onNodesChange,
    onSpacesChange,
    onRequestPersistFlush,
    onShowMessage,
    defaultTerminalWindowScalePercent: agentSettings.defaultTerminalWindowScalePercent,
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
    focusSpaceInViewport,
    focusAllInViewport,
  } = workspaceCanvasHooks.useWorkspaceCanvasSpaces({
    workspaceId,
    activeSpaceId,
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
  const { buildAgentNodeTitle, launchAgentInNode } =
    workspaceCanvasHooks.useWorkspaceCanvasAgentNodeLifecycle({
      nodesRef,
      setNodes,
      bumpAgentLaunchToken,
      isAgentLaunchTokenCurrent,
      agentFullAccess: agentSettings.agentFullAccess,
    })
  const { openAgentLauncher, openAgentLauncherForProvider } =
    workspaceCanvasHooks.useWorkspaceCanvasAgentLauncher({
      agentSettings,
      workspacePath,
      nodesRef,
      setNodes,
      spacesRef: canvasState.spacesRef,
      onSpacesChange,
      onRequestPersistFlush,
      onShowMessage,
      contextMenu: canvasState.contextMenu,
      setContextMenu: canvasState.setContextMenu,
      createNodeForSession,
      buildAgentNodeTitle,
    })
  const taskTagOptions = workspaceCanvasHooks.useWorkspaceCanvasTaskTagOptions(
    agentSettings.taskTagOptions,
  )
  const { suggestTaskTitle } = workspaceCanvasHooks.useWorkspaceCanvasTaskActions({
    nodesRef,
    spacesRef: canvasState.spacesRef,
    onSpacesChange,
    setNodes,
    createNodeForSession,
    buildAgentNodeTitle,
    launchAgentInNode,
    agentSettings,
    workspacePath,
    taskTagOptions,
    onRequestPersistFlush,
    runTaskAgentRef: actionRefs.runTaskAgentRef,
    resumeTaskAgentSessionRef: actionRefs.resumeTaskAgentSessionRef,
    removeTaskAgentSessionRecordRef: actionRefs.removeTaskAgentSessionRecordRef,
    updateTaskStatusRef: actionRefs.updateTaskStatusRef,
    quickUpdateTaskTitleRef: actionRefs.quickUpdateTaskTitleRef,
    quickUpdateTaskRequirementRef: actionRefs.quickUpdateTaskRequirementRef,
  })
  const {
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
  } = workspaceCanvasHooks.useWorkspaceCanvasTaskWindows({
    taskTagOptions,
    contextMenu: canvasState.contextMenu,
    setContextMenu: canvasState.setContextMenu,
    nodesRef,
    setNodes,
    spacesRef: canvasState.spacesRef,
    onSpacesChange,
    onRequestPersistFlush,
    suggestTaskTitle,
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
  workspaceCanvasHooks.useWorkspaceCanvasLifecycle({
    workspaceId,
    persistedMinimapVisible,
    setIsMinimapVisible: canvasState.setIsMinimapVisible,
    setSelectedNodeIds: canvasState.setSelectedNodeIds,
    setSelectedSpaceIds: canvasState.setSelectedSpaceIds,
    setContextMenu: canvasState.setContextMenu,
    setEmptySelectionPrompt: canvasState.setEmptySelectionPrompt,
    cancelSpaceRename,
    selectionDraftRef: canvasState.selectionDraftRef,
    trackpadGestureLockRef: canvasState.trackpadGestureLockRef,
    restoredViewportWorkspaceIdRef: canvasState.restoredViewportWorkspaceIdRef,
    reactFlow,
    viewport,
    viewportRef: canvasState.viewportRef,
    canvasInputModeSetting: agentSettings.canvasInputMode,
    inputModalityStateRef: canvasState.inputModalityStateRef,
    setDetectedCanvasInputMode: canvasState.setDetectedCanvasInputMode,
    isShiftPressedRef: canvasState.isShiftPressedRef,
    setIsShiftPressed: canvasState.setIsShiftPressed,
    selectedNodeIdsRef: canvasState.selectedNodeIdsRef,
    requestNodeDeleteRef: actionRefs.requestNodeDeleteRef,
    focusNodeId,
    focusSequence,
    focusNodeTargetZoom: agentSettings.focusNodeTargetZoom,
    isFocusNodeTargetZoomPreviewing,
    nodesRef,
  })
  workspaceCanvasHooks.useWorkspaceCanvasPtyTaskCompletion({ setNodes, onRequestPersistFlush })
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
  } = workspaceCanvasHooks.useWorkspaceCanvasInteractions({
    isTrackpadCanvasMode,
    focusNodeOnClick: agentSettings.focusNodeOnClick,
    focusNodeTargetZoom: agentSettings.focusNodeTargetZoom,
    defaultTerminalWindowScalePercent: agentSettings.defaultTerminalWindowScalePercent,
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
    createNodeForSession,
    createNoteNode,
  })
  const {
    canConvertSelectedNoteToTask,
    isConvertSelectedNoteToTaskDisabled,
    convertSelectedNoteToTask,
  } = workspaceCanvasHooks.useWorkspaceCanvasNoteToTaskConversion({
    selectedNodeIds: canvasState.selectedNodeIds,
    selectedNodeIdsRef: canvasState.selectedNodeIdsRef,
    flowNodes: canvasState.flowNodes,
    nodesRef,
    setNodes,
    onRequestPersistFlush,
    onShowMessage,
    setContextMenu: canvasState.setContextMenu,
  })
  const copyAgentLastMessage = workspaceCanvasHooks.useWorkspaceCanvasAgentLastMessageCopy({
    nodesRef,
    onShowMessage,
  })
  workspaceCanvasHooks.useWorkspaceCanvasSyncActionRefs({
    actionRefs,
    clearNodeSelection,
    closeNode,
    resizeNode,
    copyAgentLastMessage,
    updateNoteText,
    updateNodeScrollback,
    updateTerminalTitle,
    renameTerminalTitle,
    focusNodeOnClick: agentSettings.focusNodeOnClick,
    focusNodeTargetZoom: agentSettings.focusNodeTargetZoom,
    nodesRef,
    reactFlow,
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
      focusSpaceInViewport={focusSpaceInViewport}
      focusAllInViewport={focusAllInViewport}
      contextMenu={canvasState.contextMenu}
      closeContextMenu={spaceUi.closeContextMenu}
      createTerminalNode={createTerminalNode}
      createNoteNodeFromContextMenu={createNoteNodeFromContextMenu}
      openTaskCreator={openTaskCreator}
      openAgentLauncher={openAgentLauncher}
      openAgentLauncherForProvider={openAgentLauncherForProvider}
      createSpaceFromSelectedNodes={createSpaceFromSelectedNodes}
      clearNodeSelection={clearNodeSelection}
      canConvertSelectedNoteToTask={canConvertSelectedNoteToTask}
      isConvertSelectedNoteToTaskDisabled={isConvertSelectedNoteToTaskDisabled}
      convertSelectedNoteToTask={convertSelectedNoteToTask}
      setSelectedNodeLabelColorOverride={labelColorOverride =>
        setNodeLabelColorOverride(canvasState.selectedNodeIdsRef.current, labelColorOverride)
      }
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
