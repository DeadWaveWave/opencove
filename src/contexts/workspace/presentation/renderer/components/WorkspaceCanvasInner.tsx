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
  onAppendSpaceArchiveRecord,
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
  // prettier-ignore
  const nodeDragPreviewState = workspaceCanvasHooks.useWorkspaceCanvasNodeDragPreviewState(workspaceId)
  const canvasState = workspaceCanvasHooks.useWorkspaceCanvasState({
    nodes,
    spaces,
    viewport,
    persistedMinimapVisible,
  })
  // prettier-ignore
  const exclusiveNodeDragAnchorIdRef = workspaceCanvasHooks.useWorkspaceCanvasWorkspaceReset(workspaceId)
  const actionRefs = workspaceCanvasHooks.useWorkspaceCanvasActionRefs()
  const nodeStore = workspaceCanvasHooks.useWorkspaceCanvasNodesStore({
    nodes: canvasState.flowNodes,
    spacesRef: canvasState.spacesRef,
    onNodesChange,
    onSpacesChange,
    onRequestPersistFlush,
    onShowMessage,
    standardWindowSizeBucket: agentSettings.standardWindowSizeBucket,
  })
  // prettier-ignore
  const { updateSpaceDirectory, getSpaceBlockingNodes, closeNodesById } = workspaceCanvasHooks.useWorkspaceCanvasSpaceDirectoryOps({ workspacePath, spacesRef: canvasState.spacesRef, nodesRef: nodeStore.nodesRef, setNodes: nodeStore.setNodes, onSpacesChange, onRequestPersistFlush, closeNode: nodeStore.closeNode })
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
    focusNodeTargetZoom: agentSettings.focusNodeTargetZoom,
    reactFlow,
    nodes: canvasState.flowNodes,
    nodesRef: nodeStore.nodesRef,
    setNodes: nodeStore.setNodes,
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
      nodesRef: nodeStore.nodesRef,
      spacesRef: canvasState.spacesRef,
      selectedNodeIdsRef: canvasState.selectedNodeIdsRef,
      selectedSpaceIdsRef: canvasState.selectedSpaceIdsRef,
      setNodes: nodeStore.setNodes,
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
    setNodes: nodeStore.setNodes,
    onSpacesChange,
    onRequestPersistFlush,
    onShowMessage,
    hideWorktreeMismatchDropWarning: agentSettings.hideWorktreeMismatchDropWarning === true,
    nodeDragPointerAnchorRef: nodeDragPreviewState.nodeDragPointerAnchorRef,
    nodeSpaceFramePreviewRef: nodeDragPreviewState.nodeSpaceFramePreviewRef,
  })
  const {
    buildAgentNodeTitle,
    launchAgentInNode,
    openAgentLauncher,
    openAgentLauncherForProvider,
  } = workspaceCanvasHooks.useWorkspaceCanvasAgentSupport({
    nodesRef: nodeStore.nodesRef,
    setNodes: nodeStore.setNodes,
    bumpAgentLaunchToken: nodeStore.bumpAgentLaunchToken,
    isAgentLaunchTokenCurrent: nodeStore.isAgentLaunchTokenCurrent,
    agentSettings,
    workspacePath,
    spacesRef: canvasState.spacesRef,
    onSpacesChange,
    onRequestPersistFlush,
    onShowMessage,
    contextMenu: canvasState.contextMenu,
    setContextMenu: canvasState.setContextMenu,
    createNodeForSession: nodeStore.createNodeForSession,
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
    nodesRef: nodeStore.nodesRef,
    setNodes: nodeStore.setNodes,
    spacesRef: canvasState.spacesRef,
    onSpacesChange,
    onRequestPersistFlush,
    createNodeForSession: nodeStore.createNodeForSession,
    buildAgentNodeTitle,
    launchAgentInNode,
    agentSettings,
    workspacePath,
    standardWindowSizeBucket: agentSettings.standardWindowSizeBucket,
    createTaskNode: nodeStore.createTaskNode,
    closeNode: nodeStore.closeNode,
    actionRefs,
  })
  const {
    resolvedCanvasInputMode,
    isTrackpadCanvasMode,
    useManualCanvasWheelGestures,
    handleCanvasWheelCapture,
  } = workspaceCanvasHooks.useWorkspaceCanvasInputMode({
    canvasInputModeSetting: agentSettings.canvasInputMode,
    canvasWheelBehaviorSetting: agentSettings.canvasWheelBehavior,
    canvasWheelZoomModifierSetting: agentSettings.canvasWheelZoomModifier,
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
    nodesRef: nodeStore.nodesRef,
    requestNodeDeleteRef: actionRefs.requestNodeDeleteRef,
  })
  const nodeTypes = workspaceCanvasHooks.useWorkspaceCanvasComposedNodeTypes({
    setNodes: nodeStore.setNodes,
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
    createWebsiteNodeFromContextMenu,
    handleCanvasPaste,
    handleCanvasDragOver,
    handleCanvasDrop,
  } = workspaceCanvasHooks.useWorkspaceCanvasInteractions({
    canvasRef: canvasState.canvasRef,
    isTrackpadCanvasMode,
    focusNodeOnClick: agentSettings.focusNodeOnClick,
    focusNodeTargetZoom: agentSettings.focusNodeTargetZoom,
    websiteWindowsEnabled: agentSettings.websiteWindowPolicy.enabled,
    websiteWindowPasteEnabled: agentSettings.experimentalWebsiteWindowPasteEnabled,
    isShiftPressedRef: canvasState.isShiftPressedRef,
    selectionDraftRef: canvasState.selectionDraftRef,
    setSelectionDraftUi: canvasState.setSelectionDraftUi,
    reactFlow,
    setNodes: nodeStore.setNodes,
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
    nodesRef: nodeStore.nodesRef,
    standardWindowSizeBucket: agentSettings.standardWindowSizeBucket,
    createNodeForSession: nodeStore.createNodeForSession,
    createNoteNode: nodeStore.createNoteNode,
    onShowMessage,
    createImageNode: nodeStore.createImageNode,
    createWebsiteNode: nodeStore.createWebsiteNode,
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
    nodesRef: nodeStore.nodesRef,
    setNodes: nodeStore.setNodes,
    onSpacesChange,
    createNodeForSession: nodeStore.createNodeForSession,
    createNoteNode: nodeStore.createNoteNode,
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
    nodesRef: nodeStore.nodesRef,
    setNodes: nodeStore.setNodes,
    onRequestPersistFlush,
    onShowMessage,
    setContextMenu: canvasState.setContextMenu,
    reactFlow,
    spacesRef: canvasState.spacesRef,
    onSpacesChange,
    standardWindowSizeBucket: agentSettings.standardWindowSizeBucket,
    focusNodeTargetZoom: agentSettings.focusNodeTargetZoom,
  })
  workspaceCanvasHooks.useWorkspaceCanvasRuntimeBindings({
    setNodes: nodeStore.setNodes,
    onRequestPersistFlush,
    actionRefs,
    clearNodeSelection,
    closeNode: requestNodeClose,
    resizeNode: nodeStore.resizeNode,
    updateNoteText: nodeStore.updateNoteText,
    updateWebsiteUrl: nodeStore.updateWebsiteUrl,
    setWebsitePinned: nodeStore.setWebsitePinned,
    setWebsiteSession: nodeStore.setWebsiteSession,
    updateNodeScrollback: nodeStore.updateNodeScrollback,
    updateTerminalTitle: nodeStore.updateTerminalTitle,
    renameTerminalTitle: nodeStore.renameTerminalTitle,
    focusNodeOnClick: agentSettings.focusNodeOnClick,
    focusNodeTargetZoom: agentSettings.focusNodeTargetZoom,
    nodesRef: nodeStore.nodesRef,
    reactFlow,
    onShowMessage,
  })
  const applyChanges = workspaceCanvasHooks.useWorkspaceCanvasApplyNodeChanges({
    nodesRef: nodeStore.nodesRef,
    onNodesChange,
    clearAgentLaunchToken: nodeStore.clearAgentLaunchToken,
    normalizePosition: nodeStore.normalizePosition,
    applyPendingScrollbacks: nodeStore.applyPendingScrollbacks,
    isNodeDraggingRef: nodeStore.isNodeDraggingRef,
    spacesRef: canvasState.spacesRef,
    selectedSpaceIdsRef: canvasState.selectedSpaceIdsRef,
    dragSelectedSpaceIdsRef: canvasState.dragSelectedSpaceIdsRef,
    magneticSnappingEnabledRef: canvasState.magneticSnappingEnabledRef,
    setSnapGuides: canvasState.setSnapGuides,
    exclusiveNodeDragAnchorIdRef,
    onSpacesChange,
    onRequestPersistFlush,
    setSpaceFramePreview: nodeDragPreviewState.setNodeSpaceFramePreview,
    nodeDragPointerAnchorRef: nodeDragPreviewState.nodeDragPointerAnchorRef,
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
  const spaceExplorer = workspaceCanvasHooks.useWorkspaceCanvasSpaceExplorer({
    canvasRef: canvasState.canvasRef,
    spaces,
    spacesRef: canvasState.spacesRef,
    nodesRef: nodeStore.nodesRef,
    setNodes: nodeStore.setNodes,
    onSpacesChange,
    onRequestPersistFlush,
    reactFlow,
    createDocumentNode: nodeStore.createDocumentNode,
    createImageNode: nodeStore.createImageNode,
  })
  return (
    <WorkspaceCanvasView
      canvasRef={canvasState.canvasRef}
      resolvedCanvasInputMode={resolvedCanvasInputMode}
      {...spaceUi}
      {...spaceExplorer}
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
      onNodeClick={handleNodeClick}
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
      spaceFramePreview={spaceFramePreview ?? nodeDragPreviewState.nodeSpaceFramePreview}
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
      magneticSnappingEnabled={canvasState.magneticSnappingEnabled}
      onToggleMagneticSnapping={() => canvasState.setMagneticSnappingEnabled(enabled => !enabled)}
      createTerminalNode={createTerminalNode}
      createNoteNodeFromContextMenu={createNoteNodeFromContextMenu}
      createWebsiteNodeFromContextMenu={createWebsiteNodeFromContextMenu}
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
      setSelectedNodeLabelColorOverride={override =>
        nodeStore.setNodeLabelColorOverride(canvasState.selectedNodeIdsRef.current, override)
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
      worktreesRoot={worktreesRoot}
      onShowMessage={onShowMessage}
      onAppendSpaceArchiveRecord={onAppendSpaceArchiveRecord}
      updateSpaceDirectory={updateSpaceDirectory}
      getSpaceBlockingNodes={getSpaceBlockingNodes}
      closeNodesById={closeNodesById}
    />
  )
}
