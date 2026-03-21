import React, { useRef } from 'react'
import { ReactFlowProvider, useReactFlow, type Edge, type Node } from '@xyflow/react'
import type { TerminalNodeData } from '../types'
import * as workspaceCanvasHooks from './workspaceCanvas/hooks'
import { normalizeTaskTagOptions } from './workspaceCanvas/helpers'
import { WorkspaceCanvasView } from './workspaceCanvas/WorkspaceCanvasView'
import type { WorkspaceCanvasProps } from './workspaceCanvas/types'
function WorkspaceCanvasInner({
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
  focusNodeId,
  focusSequence,
}: WorkspaceCanvasProps): React.JSX.Element {
  const reactFlow = useReactFlow<Node<TerminalNodeData>, Edge>()
  const createdNodeNodesRef = useRef<React.MutableRefObject<Node<TerminalNodeData>[]> | null>(null)
  const {
    contextMenu,
    setContextMenu,
    isMinimapVisible,
    setIsMinimapVisible,
    selectedNodeIds,
    setSelectedNodeIds,
    selectedSpaceIds,
    setSelectedSpaceIds,
    setEmptySelectionPrompt,
    detectedCanvasInputMode,
    setDetectedCanvasInputMode,
    isShiftPressed,
    setIsShiftPressed,
    canvasRef,
    restoredViewportWorkspaceIdRef,
    spacesRef,
    selectedNodeIdsRef,
    selectedSpaceIdsRef,
    dragSelectedSpaceIdsRef,
    selectionDraftRef,
    selectionDraftUi,
    setSelectionDraftUi,
    inputModalityStateRef,
    isShiftPressedRef,
    trackpadGestureLockRef,
    viewportRef,
    flowNodes,
  } = workspaceCanvasHooks.useWorkspaceCanvasState({
    nodes,
    spaces,
    viewport,
    persistedMinimapVisible,
  })
  const actionRefs = workspaceCanvasHooks.useWorkspaceCanvasActionRefs()
  const centerCreatedNode = workspaceCanvasHooks.useWorkspaceCanvasCreatedNodeViewportCenter
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
    updateNoteText,
    createNodeForSession,
    createNoteNode,
    createTaskNode,
  } = workspaceCanvasHooks.useWorkspaceCanvasNodesStore({
    nodes: flowNodes,
    spacesRef,
    onNodesChange,
    onSpacesChange,
    onRequestPersistFlush,
    onShowMessage,
    defaultTerminalWindowScalePercent: agentSettings.defaultTerminalWindowScalePercent,
    onNodeCreated: centerCreatedNode(reactFlow, createdNodeNodesRef, viewportRef),
  })
  createdNodeNodesRef.current = nodesRef
  const { updateSpaceDirectory, getSpaceBlockingNodes, closeNodesById } =
    workspaceCanvasHooks.useWorkspaceCanvasSpaceDirectoryOps({
      workspacePath,
      spacesRef,
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
    createSpaceFromSelectedNodes,
    spaceVisuals,
    focusSpaceInViewport,
    focusAllInViewport,
  } = workspaceCanvasHooks.useWorkspaceCanvasSpaces({
    workspaceId,
    activeSpaceId,
    workspacePath,
    reactFlow,
    nodes: flowNodes,
    nodesRef,
    setNodes,
    spaces,
    spacesRef,
    selectedNodeIds,
    selectedNodeIdsRef,
    onSpacesChange,
    onRequestPersistFlush,
    setContextMenu,
    setEmptySelectionPrompt,
    onShowMessage,
  })
  const { spaceFramePreview, handleSpaceDragHandlePointerDown } =
    workspaceCanvasHooks.useWorkspaceCanvasSpaceDrag({
      workspaceId,
      reactFlow,
      nodesRef,
      spacesRef,
      selectedNodeIdsRef,
      selectedSpaceIdsRef,
      setNodes,
      onSpacesChange,
      setSelectedNodeIds,
      setSelectedSpaceIds,
      onRequestPersistFlush,
      setContextMenu,
      cancelSpaceRename,
      setEmptySelectionPrompt,
    })
  const {
    handleNodeDragStart,
    handleSelectionDragStart,
    handleNodeDragStop,
    handleSelectionDragStop,
  } = workspaceCanvasHooks.useWorkspaceCanvasSpaceOwnership({
    workspacePath,
    reactFlow,
    spacesRef,
    selectedSpaceIdsRef,
    dragSelectedSpaceIdsRef,
    setNodes,
    onSpacesChange,
    onRequestPersistFlush,
    onShowMessage,
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
      spacesRef,
      onSpacesChange,
      onRequestPersistFlush,
      onShowMessage,
      contextMenu,
      setContextMenu,
      createNodeForSession,
      buildAgentNodeTitle,
    })
  const taskTagOptions = normalizeTaskTagOptions(agentSettings.taskTagOptions)
  const { suggestTaskTitle } = workspaceCanvasHooks.useWorkspaceCanvasTaskActions({
    nodesRef,
    spacesRef,
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
    contextMenu,
    setContextMenu,
    nodesRef,
    setNodes,
    spacesRef,
    onSpacesChange,
    onRequestPersistFlush,
    suggestTaskTitle,
    createTaskNode,
    closeNode,
    actionRefs,
  })
  const canvasInputModeSetting = agentSettings.canvasInputMode
  const resolvedCanvasInputMode =
    canvasInputModeSetting === 'auto' ? detectedCanvasInputMode : canvasInputModeSetting
  const isTrackpadCanvasMode = resolvedCanvasInputMode === 'trackpad'
  const useManualCanvasWheelGestures = canvasInputModeSetting !== 'mouse'
  const { handleCanvasWheelCapture } = workspaceCanvasHooks.useWorkspaceCanvasTrackpadGestures({
    canvasInputModeSetting,
    resolvedCanvasInputMode,
    inputModalityStateRef,
    setDetectedCanvasInputMode,
    canvasRef,
    trackpadGestureLockRef,
    viewportRef,
    reactFlow,
    onViewportChange,
  })
  workspaceCanvasHooks.useWorkspaceCanvasLifecycle({
    workspaceId,
    persistedMinimapVisible,
    setIsMinimapVisible,
    setSelectedNodeIds,
    setSelectedSpaceIds,
    setContextMenu,
    setEmptySelectionPrompt,
    cancelSpaceRename,
    selectionDraftRef,
    trackpadGestureLockRef,
    restoredViewportWorkspaceIdRef,
    reactFlow,
    viewport,
    viewportRef,
    canvasInputModeSetting,
    inputModalityStateRef,
    setDetectedCanvasInputMode,
    isShiftPressedRef,
    setIsShiftPressed,
    selectedNodeIdsRef,
    requestNodeDeleteRef: actionRefs.requestNodeDeleteRef,
    focusNodeId,
    focusSequence,
    nodesRef,
  })
  workspaceCanvasHooks.useWorkspaceCanvasPtyTaskCompletion({ setNodes, onRequestPersistFlush })
  const nodeTypes = workspaceCanvasHooks.useWorkspaceCanvasComposedNodeTypes({
    setNodes,
    setSelectedNodeIds,
    setSelectedSpaceIds,
    selectedNodeIdsRef,
    selectedSpaceIdsRef,
    spacesRef,
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
    normalizeZoomOnNodeClick: agentSettings.normalizeZoomOnTerminalClick,
    defaultTerminalWindowScalePercent: agentSettings.defaultTerminalWindowScalePercent,
    isShiftPressedRef,
    selectionDraftRef,
    setSelectionDraftUi,
    reactFlow,
    setNodes,
    setSelectedNodeIds,
    setSelectedSpaceIds,
    setContextMenu,
    setEmptySelectionPrompt,
    cancelSpaceRename,
    selectedNodeIdsRef,
    selectedSpaceIdsRef,
    contextMenu,
    workspacePath,
    defaultTerminalProfileId: agentSettings.defaultTerminalProfileId,
    spacesRef,
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
    selectedNodeIds,
    selectedNodeIdsRef,
    flowNodes,
    nodesRef,
    setNodes,
    onRequestPersistFlush,
    onShowMessage,
    setContextMenu,
  })
  const copyAgentLastMessage = workspaceCanvasHooks.useWorkspaceCanvasAgentLastMessageCopy({
    nodesRef,
    onShowMessage,
  })
  workspaceCanvasHooks.useWorkspaceCanvasSyncActionRefs({
    actionRefs,
    closeNode,
    resizeNode,
    copyAgentLastMessage,
    updateNoteText,
    updateNodeScrollback,
    updateTerminalTitle,
    renameTerminalTitle,
    normalizeZoomOnTerminalClick: agentSettings.normalizeZoomOnTerminalClick,
    nodesRef,
    reactFlow,
  })
  actionRefs.clearNodeSelectionRef.current = clearNodeSelection
  const applyChanges = workspaceCanvasHooks.useWorkspaceCanvasApplyNodeChanges({
    nodesRef,
    onNodesChange,
    clearAgentLaunchToken,
    normalizePosition,
    applyPendingScrollbacks,
    isNodeDraggingRef,
    spacesRef,
    selectedSpaceIdsRef,
    dragSelectedSpaceIdsRef,
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
    viewportRef,
    onViewportChange,
    flowNodes,
    contextMenu,
    setContextMenu,
    setEmptySelectionPrompt,
    cancelSpaceRename,
    workspacePath,
    spacesRef,
    handlePaneClick,
    handlePaneContextMenu,
    handleNodeContextMenu,
    handleSelectionContextMenu,
  })
  return (
    <WorkspaceCanvasView
      canvasRef={canvasRef}
      resolvedCanvasInputMode={resolvedCanvasInputMode}
      onCanvasClick={spaceUi.handleCanvasClick}
      handleCanvasPointerDownCapture={handleCanvasPointerDownCapture}
      handleCanvasPointerMoveCapture={handleCanvasPointerMoveCapture}
      handleCanvasPointerUpCapture={handleCanvasPointerUpCapture}
      handleCanvasDoubleClickCapture={handleCanvasDoubleClickCapture}
      handleCanvasWheelCapture={handleCanvasWheelCapture}
      nodes={flowNodes}
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
      isShiftPressed={isShiftPressed}
      selectionDraft={selectionDraftUi}
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
      selectedNodeCount={selectedNodeIds.length}
      isMinimapVisible={isMinimapVisible}
      minimapNodeColor={minimapNodeColor}
      setIsMinimapVisible={setIsMinimapVisible}
      onMinimapVisibilityChange={onMinimapVisibilityChange}
      spaces={spaces}
      focusSpaceInViewport={focusSpaceInViewport}
      focusAllInViewport={focusAllInViewport}
      contextMenu={contextMenu}
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
export function WorkspaceCanvas(props: WorkspaceCanvasProps): React.JSX.Element {
  return <ReactFlowProvider>{<WorkspaceCanvasInner {...props} />}</ReactFlowProvider>
}
