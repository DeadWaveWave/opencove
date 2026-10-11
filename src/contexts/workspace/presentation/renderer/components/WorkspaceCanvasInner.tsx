import { useReactFlow, type Edge, type Node } from '@xyflow/react'
import * as workspaceCanvasHooks from './workspaceCanvas/hooks'
import { TerminalDisplayAlignedWorkspaceCanvasView } from './workspaceCanvas/TerminalDisplayAlignedWorkspaceCanvasView'
import { openQuickMenuSettings } from './workspaceCanvas/openQuickMenuSettings'
import type { WorkspaceCanvasInnerProps } from './workspaceCanvas/types'
import { useCanvasCollapse } from './workspaceCanvas/collapse/useCanvasCollapse'
import { WorkspaceCanvasProviders } from './workspaceCanvas/WorkspaceCanvasProviders'
import { useCanvasSpaceExplorer } from './workspaceCanvas/hooks/useCanvasSpaceExplorer'
import { useWorkspaceCanvasActionBar } from './workspaceCanvas/hooks/useCanvasActionBarActions'
export function WorkspaceCanvasInner({
  workspaceId,
  onShowMessage,
  workspacePath,
  environmentVariables,
  worktreesRoot,
  nodes,
  onNodesChange,
  onRequestPersistFlush,
  spaces,
  activeSpaceId,
  onSpacesChange,
  onActiveSpaceChange,
  onOpenSpaceContextMenu,
  shortcutsEnabled = true,
  onAppendSpaceArchiveRecord,
  viewport,
  isMinimapVisible: persistedMinimapVisible,
  onViewportChange,
  onMinimapVisibilityChange,
  agentSettings,
  terminalDisplayCalibration = null,
  terminalDisplayMetrics,
  onChangePreserveWindowSizesOnArrange,
  isFocusNodeTargetZoomPreviewing = false,
  focusNodeId,
  focusNodeInput,
  focusSpaceId,
  focusSequence,
}: WorkspaceCanvasInnerProps) {
  const reactFlow = useReactFlow<Node<import('../types').TerminalNodeData>, Edge>()
  const canvasState = workspaceCanvasHooks.useWorkspaceCanvasState({
    workspaceId,
    nodes,
    spaces,
    viewport,
    persistedMinimapVisible,
  })
  const nodePublishers = workspaceCanvasHooks.useWorkspaceCanvasNodePublishers({
    ...canvasState,
    onNodesChange,
  })
  // prettier-ignore
  const exclusiveNodeDragAnchorIdRef = workspaceCanvasHooks.useWorkspaceCanvasWorkspaceReset(workspaceId, canvasState.selectedNodeIds.length)
  const actionRefs = workspaceCanvasHooks.useWorkspaceCanvasActionRefs()
  const nodeStore = workspaceCanvasHooks.useWorkspaceCanvasNodesStore({
    workspaceId,
    workspacePath,
    nodes: canvasState.flowNodes,
    spacesRef: canvasState.spacesRef,
    onNodesChange: nodePublishers.commitNodesChange,
    onSpacesChange,
    onRequestPersistFlush,
    onShowMessage,
    standardWindowSizeBucket: agentSettings.standardWindowSizeBucket,
    browserDefaultMode: agentSettings.browserDefaultMode,
  })
  const nodeDragSession = workspaceCanvasHooks.useWorkspaceCanvasNodeDragSession({
    workspaceId,
    spacesRef: canvasState.spacesRef,
    selectedSpaceIdsRef: canvasState.selectedSpaceIdsRef,
    dragSelectedSpaceIdsRef: canvasState.dragSelectedSpaceIdsRef,
    magneticSnappingEnabledRef: canvasState.magneticSnappingEnabledRef,
    setSnapGuides: canvasState.setSnapGuides,
    onSpacesChange,
    onRequestPersistFlush,
  })
  // prettier-ignore
  const { updateSpaceDirectory, getSpaceBlockingNodes, closeNodesById } = workspaceCanvasHooks.useWorkspaceCanvasSpaceDirectoryOps({ workspacePath, spacesRef: canvasState.spacesRef, nodesRef: nodeStore.nodesRef, setNodes: nodeStore.setNodes, onSpacesChange, onRequestPersistFlush, closeNode: nodeStore.closeNode })
  const spacesApi = workspaceCanvasHooks.useWorkspaceCanvasSpaces({
    workspaceId,
    activeSpaceId,
    onActiveSpaceChange,
    workspacePath,
    focusNodeTargetZoom: agentSettings.focusNodeTargetZoom,
    standardWindowSizeBucket: agentSettings.standardWindowSizeBucket,
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
      cancelSpaceRename: spacesApi.cancelSpaceRename,
      setEmptySelectionPrompt: canvasState.setEmptySelectionPrompt,
    })
  const {
    finalizeDraggedNodeDrop,
    handleNodeDragStart,
    handleSelectionDragStart,
    handleNodeDragStop,
    handleSelectionDragStop,
    spaceWorktreeMismatchDropWarning,
    cancelSpaceWorktreeMismatchDropWarning,
    continueSpaceWorktreeMismatchDropWarning,
  } = workspaceCanvasHooks.useWorkspaceCanvasSpaceOwnership({
    workspaceId,
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
    nodeDragPointerAnchorRef: nodeDragSession.nodeDragPointerAnchorRef,
  })
  const agentSupport = workspaceCanvasHooks.useWorkspaceCanvasAgentSupport({
    nodesRef: nodeStore.nodesRef,
    setNodes: nodeStore.setNodes,
    bumpAgentLaunchToken: nodeStore.bumpAgentLaunchToken,
    isAgentLaunchTokenCurrent: nodeStore.isAgentLaunchTokenCurrent,
    agentSettings,
    workspaceId,
    workspacePath,
    environmentVariables,
    spacesRef: canvasState.spacesRef,
    onSpacesChange,
    onRequestPersistFlush,
    onShowMessage,
    contextMenu: canvasState.contextMenu,
    setContextMenu: canvasState.setContextMenu,
    createNodeForSession: nodeStore.createNodeForSession,
    standardWindowSizeBucket: agentSettings.standardWindowSizeBucket,
    terminalDisplayMetrics,
  })
  const taskUi = workspaceCanvasHooks.useWorkspaceCanvasTaskUi({
    agentTaskTagOptions: agentSettings.taskTagOptions,
    contextMenu: canvasState.contextMenu,
    setContextMenu: canvasState.setContextMenu,
    nodesRef: nodeStore.nodesRef,
    setNodes: nodeStore.setNodes,
    spacesRef: canvasState.spacesRef,
    onSpacesChange,
    onRequestPersistFlush,
    createNodeForSession: nodeStore.createNodeForSession,
    buildAgentNodeTitle: agentSupport.buildAgentNodeTitle,
    launchAgentInNode: agentSupport.launchAgentInNode,
    agentSettings,
    workspaceId,
    workspacePath,
    environmentVariables,
    standardWindowSizeBucket: agentSettings.standardWindowSizeBucket,
    createTaskNode: nodeStore.createTaskNode,
    closeNode: nodeStore.closeNode,
    actionRefs,
    terminalDisplayMetrics,
  })
  // prettier-ignore
  const roleUiProps = workspaceCanvasHooks.useWorkspaceCanvasRoleUi({ workspaceId, workspacePath, environmentVariables, agentSettings, canvasState, nodeStore, agentSupport, onSpacesChange, onRequestPersistFlush, onShowMessage, actionRefs })
  // prettier-ignore
  const inputMode = workspaceCanvasHooks.useWorkspaceCanvasInputMode({ canvasInputModeSetting: agentSettings.canvasInputMode, canvasWheelBehaviorSetting: agentSettings.canvasWheelBehavior, canvasWheelZoomModifierSetting: agentSettings.canvasWheelZoomModifier, detectedCanvasInputMode: canvasState.detectedCanvasInputMode, inputModalityStateRef: canvasState.inputModalityStateRef, setDetectedCanvasInputMode: canvasState.setDetectedCanvasInputMode, canvasRef: canvasState.canvasRef, trackpadGestureLockRef: canvasState.trackpadGestureLockRef, setIsCanvasWheelGestureCaptureActive: canvasState.setIsCanvasWheelGestureCaptureActive, viewportRef: canvasState.viewportRef, reactFlow, onViewportChange })
  // prettier-ignore
  const collapse = useCanvasCollapse({ workspaceId, canvasRef: canvasState.canvasRef, nodes: canvasState.flowNodes, spaces, nodesRef: nodeStore.nodesRef, spacesRef: canvasState.spacesRef, setNodes: nodeStore.setNodes, onSpacesChange, reactFlow, focusNodeTargetZoom: agentSettings.focusNodeTargetZoom, nodeExpandBehavior: agentSettings.nodeExpandBehavior, onRequestPersistFlush })
  // prettier-ignore
  workspaceCanvasHooks.useWorkspaceCanvasLifecycleBindings({ workspaceId, persistedMinimapVisible, canvasState, cancelSpaceRename: spacesApi.cancelSpaceRename, reactFlow, viewport, agentSettings, focusSpaceId, focusNodeId, focusNodeInput, focusSequence, expandNode: collapse.expandNode, focusSpaceInViewport: spacesApi.focusSpaceInViewport, nodes: canvasState.flowNodes, isFocusNodeTargetZoomPreviewing, nodesRef: nodeStore.nodesRef, requestNodeDeleteRef: actionRefs.requestNodeDeleteRef })
  // prettier-ignore
  const { canConvertSelectedNoteToTask, isConvertSelectedNoteToTaskDisabled, convertSelectedNoteToTask, convertNoteToTask, arrangeAll, arrangeCanvas, arrangeInSpace } = workspaceCanvasHooks.useWorkspaceCanvasMenuActions({ selectedNodeIds: canvasState.selectedNodeIds, selectedNodeIdsRef: canvasState.selectedNodeIdsRef, flowNodes: canvasState.flowNodes, nodesRef: nodeStore.nodesRef, setNodes: nodeStore.setNodes, onRequestPersistFlush, onShowMessage, setContextMenu: canvasState.setContextMenu, reactFlow, spacesRef: canvasState.spacesRef, onSpacesChange, standardWindowSizeBucket: agentSettings.standardWindowSizeBucket, focusNodeTargetZoom: agentSettings.focusNodeTargetZoom })
  const nodeTypes = workspaceCanvasHooks.useWorkspaceCanvasComposedNodeTypes({
    setNodes: nodeStore.setNodes,
    setSelectedNodeIds: canvasState.setSelectedNodeIds,
    setSelectedSpaceIds: canvasState.setSelectedSpaceIds,
    selectedNodeIdsRef: canvasState.selectedNodeIdsRef,
    selectedSpaceIdsRef: canvasState.selectedSpaceIdsRef,
    spacesRef: canvasState.spacesRef,
    workspacePath,
    onShowMessage,
    agentSettings,
    actionRefs,
    convertNoteToTask,
    setNodeLabelColorOverride: nodeStore.setNodeLabelColorOverride,
  })
  const {
    clearNodeSelection,
    handleNodeClick,
    handleSelectionContextMenu,
    handleNodeContextMenu,
    handlePaneContextMenu,
    handleCanvasPointerDownCapture,
    handleCanvasPointerMoveCapture,
    handleCanvasPointerUpCapture,
    handleCanvasDoubleClickCapture,
    handlePaneClick,
    createTerminalNode,
    createTerminalNodeAtFlowPoint,
    createNoteNodeAtFlowPoint,
    createWebsiteNodeAtFlowPoint,
    createNoteNodeFromContextMenu,
    createWebsiteNodeFromContextMenu,
    runQuickCommand,
    insertQuickPhrase,
    handleCanvasPaste,
    handleCanvasDragOver,
    handleCanvasDrop,
  } = workspaceCanvasHooks.useWorkspaceCanvasInteractions({
    canvasRef: canvasState.canvasRef,
    isTrackpadCanvasMode: inputMode.isTrackpadCanvasMode,
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
    cancelSpaceRename: spacesApi.cancelSpaceRename,
    selectedNodeIdsRef: canvasState.selectedNodeIdsRef,
    selectedSpaceIdsRef: canvasState.selectedSpaceIdsRef,
    contextMenu: canvasState.contextMenu,
    workspaceId,
    workspacePath,
    environmentVariables,
    defaultTerminalProfileId: agentSettings.defaultTerminalProfileId,
    terminalFontSize: agentSettings.terminalFontSize,
    terminalDisplayMetrics,
    spacesRef: canvasState.spacesRef,
    onSpacesChange,
    nodesRef: nodeStore.nodesRef,
    standardWindowSizeBucket: agentSettings.standardWindowSizeBucket,
    browserDefaultMode: agentSettings.browserDefaultMode,
    createNodeForSession: nodeStore.createNodeForSession,
    createNoteNode: nodeStore.createNoteNode,
    onShowMessage,
    createImageNode: nodeStore.createImageNode,
    createWebsiteNode: nodeStore.createWebsiteNode,
  })
  const actionBarActions = useWorkspaceCanvasActionBar({
    canvasRef: canvasState.canvasRef,
    reactFlow,
    createAgentAtPoint: agentSupport.launchAgentAtFlowPosition,
    createTerminalAtPoint: createTerminalNodeAtFlowPoint,
    createNoteAtPoint: createNoteNodeAtFlowPoint,
    createTaskAtPoint: taskUi.createTaskAtPoint,
    createWebsiteAtPoint: createWebsiteNodeAtFlowPoint,
    createSpaceAtPoint: spacesApi.createEmptySpaceAtPoint,
    createPluginAtPoint: (anchor, pluginId) => {
      nodeStore.createPluginNode(anchor, pluginId)
    },
    setContextMenu: canvasState.setContextMenu,
    setEmptySelectionPrompt: canvasState.setEmptySelectionPrompt,
    cancelSpaceRename: spacesApi.cancelSpaceRename,
    spacesRef: canvasState.spacesRef,
  })
  const createPluginNodeFromContextMenu = workspaceCanvasHooks.useWorkspaceCanvasPluginEntry({
    contextMenu: canvasState.contextMenu,
    setContextMenu: canvasState.setContextMenu,
    createPluginNode: nodeStore.createPluginNode,
  })
  workspaceCanvasHooks.useWorkspaceCanvasShortcutActions({
    closeNode: taskUi.requestNodeClose,
    enabled: shortcutsEnabled,
    workspaceId,
    activeSpaceId,
    spaces,
    agentSettings,
    workspacePath,
    environmentVariables,
    canvasRef: canvasState.canvasRef,
    setContextMenu: canvasState.setContextMenu,
    setEmptySelectionPrompt: canvasState.setEmptySelectionPrompt,
    cancelSpaceRename: spacesApi.cancelSpaceRename,
    reactFlow,
    spacesRef: canvasState.spacesRef,
    spaceNavigationAnchorIdRef: canvasState.spaceNavigationAnchorIdRef,
    nodesRef: nodeStore.nodesRef,
    setNodes: nodeStore.setNodes,
    setSelectedNodeIds: canvasState.setSelectedNodeIds,
    setSelectedSpaceIds: canvasState.setSelectedSpaceIds,
    selectedNodeIdsRef: canvasState.selectedNodeIdsRef,
    selectedSpaceIdsRef: canvasState.selectedSpaceIdsRef,
    onSpacesChange,
    nodeCreation: nodeStore,
    createSpaceFromSelectedNodes: spacesApi.createSpaceFromSelectedNodes,
    launchAgentAtFlowPosition: agentSupport.launchAgentAtFlowPosition,
    activateSpace: spacesApi.activateSpace,
    setActiveSpaceIdFromNodeNavigation: spacesApi.setActiveSpaceIdFromNodeNavigation,
    clearNodeSelection,
    onShowMessage,
    terminalDisplayMetrics,
  })
  const applyChanges = workspaceCanvasHooks.useWorkspaceCanvasRuntimeIntegrations({
    actionRefs,
    nodeStore,
    taskUi,
    agentSupport,
    agentSettings,
    reactFlow,
    clearNodeSelection,
    onRequestPersistFlush,
    onShowMessage,
    canvasState,
    nodePublishers,
    nodeDragSession,
    exclusiveNodeDragAnchorIdRef,
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
    cancelSpaceRename: spacesApi.cancelSpaceRename,
    workspacePath,
    spacesRef: canvasState.spacesRef,
    handlePaneClick,
    handlePaneContextMenu,
    handleNodeContextMenu,
    handleSelectionContextMenu,
  })
  // prettier-ignore
  const spaceExplorer = useCanvasSpaceExplorer({ workspaceId, canvasState, nodeStore, spaces, onSpacesChange, onRequestPersistFlush, reactFlow, nodeDragSession, finalizeDraggedNodeDrop, agentSettings, expandNode: collapse.expandNode })
  return (
    <WorkspaceCanvasProviders
      collapse={collapse}
      openSpaceExplorer={spaceExplorer.openSpaceExplorer}
      openExplorerSpaceId={spaceExplorer.openExplorerSpaceId}
      workspaceId={workspaceId}
      workspacePath={workspacePath}
      nodeStore={nodeStore}
      spacesRef={canvasState.spacesRef}
      onSpacesChange={onSpacesChange}
      onRequestPersistFlush={onRequestPersistFlush}
      onShowMessage={onShowMessage}
      setContextMenu={canvasState.setContextMenu}
      closeOtherMenus={spaceUi.closeSpaceActionMenu}
    >
      <TerminalDisplayAlignedWorkspaceCanvasView
        workspaceId={workspaceId}
        terminalFontSize={agentSettings.terminalFontSize}
        terminalFontFamily={agentSettings.terminalFontFamily}
        terminalDisplayCalibration={terminalDisplayCalibration}
        canvasRef={canvasState.canvasRef}
        resolvedCanvasInputMode={inputMode.resolvedCanvasInputMode}
        isCanvasWheelGestureCaptureActive={canvasState.isCanvasWheelGestureCaptureActive}
        {...spaceUi}
        {...spaceExplorer}
        handleCanvasPointerDownCapture={handleCanvasPointerDownCapture}
        handleCanvasPointerMoveCapture={handleCanvasPointerMoveCapture}
        handleCanvasPointerUpCapture={handleCanvasPointerUpCapture}
        handleCanvasDoubleClickCapture={handleCanvasDoubleClickCapture}
        handleCanvasWheelCapture={inputMode.handleCanvasWheelCapture}
        handleCanvasPaste={handleCanvasPaste}
        handleCanvasDragOver={handleCanvasDragOver}
        handleCanvasDrop={handleCanvasDrop}
        {...actionBarActions}
        nodes={canvasState.flowNodes}
        edges={taskAgentEdges}
        nodeTypes={nodeTypes}
        onNodesChange={applyChanges}
        onNodeClick={handleNodeClick}
        onNodeDragStart={handleNodeDragStart}
        onSelectionDragStart={handleSelectionDragStart}
        onNodeDragStop={handleNodeDragStop}
        onSelectionDragStop={handleSelectionDragStop}
        onMoveEnd={handleViewportMoveEnd}
        viewport={viewport}
        isTrackpadCanvasMode={inputMode.isTrackpadCanvasMode}
        useManualCanvasWheelGestures={inputMode.useManualCanvasWheelGestures}
        isShiftPressed={canvasState.isShiftPressed}
        selectionDraft={canvasState.selectionDraftUi}
        snapGuides={canvasState.snapGuides}
        spaceVisuals={spacesApi.spaceVisuals}
        spaceFramePreview={spaceFramePreview ?? nodeDragSession.nodeSpaceFramePreview}
        selectedSpaceIds={canvasState.selectedSpaceIds}
        handleSpaceDragHandlePointerDown={handleSpaceDragHandlePointerDown}
        editingSpaceId={spacesApi.editingSpaceId}
        spaceRenameInputRef={spacesApi.spaceRenameInputRef}
        spaceRenameDraft={spacesApi.spaceRenameDraft}
        setSpaceRenameDraft={spacesApi.setSpaceRenameDraft}
        commitSpaceRename={spacesApi.commitSpaceRename}
        cancelSpaceRename={spacesApi.cancelSpaceRename}
        startSpaceRename={spacesApi.startSpaceRename}
        setSpaceLabelColor={spacesApi.setSpaceLabelColor}
        selectedNodeCount={canvasState.selectedNodeIds.length}
        isMinimapVisible={canvasState.isMinimapVisible}
        minimapNodeColor={minimapNodeColor}
        setIsMinimapVisible={canvasState.setIsMinimapVisible}
        onMinimapVisibilityChange={onMinimapVisibilityChange}
        spaces={spaces}
        activateSpace={spacesApi.activateSpace}
        activateAllSpaces={spacesApi.activateAllSpaces}
        onOpenSpaceContextMenu={onOpenSpaceContextMenu}
        contextMenu={canvasState.contextMenu}
        magneticSnappingEnabled={canvasState.magneticSnappingEnabled}
        onToggleMagneticSnapping={() => canvasState.setMagneticSnappingEnabled(enabled => !enabled)}
        createTerminalNode={createTerminalNode}
        createNoteNodeFromContextMenu={createNoteNodeFromContextMenu}
        createWebsiteNodeFromContextMenu={createWebsiteNodeFromContextMenu}
        createPluginNodeFromContextMenu={createPluginNodeFromContextMenu}
        arrangeAll={arrangeAll}
        arrangeCanvas={arrangeCanvas}
        arrangeInSpace={arrangeInSpace}
        openTaskCreator={taskUi.openTaskCreator}
        openAgentLauncher={agentSupport.openAgentLauncher}
        openAgentLauncherForProvider={agentSupport.openAgentLauncherForProvider}
        runQuickCommand={runQuickCommand}
        insertQuickPhrase={insertQuickPhrase}
        openQuickMenuSettings={openQuickMenuSettings}
        createSpaceFromSelectedNodes={spacesApi.createSpaceFromSelectedNodes}
        createChildSpaceInParent={spacesApi.createChildSpaceInParent}
        createEmptySpaceAtPoint={spacesApi.createEmptySpaceAtPoint}
        spaceTargetMountPicker={spacesApi.spaceTargetMountPicker}
        setSpaceTargetMountPicker={spacesApi.setSpaceTargetMountPicker}
        confirmSpaceTargetMountPicker={spacesApi.confirmSpaceTargetMountPicker}
        cancelSpaceTargetMountPicker={spacesApi.cancelSpaceTargetMountPicker}
        clearNodeSelection={clearNodeSelection}
        canConvertSelectedNoteToTask={canConvertSelectedNoteToTask}
        isConvertSelectedNoteToTaskDisabled={isConvertSelectedNoteToTaskDisabled}
        convertSelectedNoteToTask={convertSelectedNoteToTask}
        setSelectedNodeLabelColorOverride={override =>
          nodeStore.setNodeLabelColorOverride(canvasState.selectedNodeIds, override)
        }
        taskCreator={taskUi.taskCreator}
        taskTitleProviderLabel={taskTitleProviderLabel}
        taskTitleModelLabel={taskTitleModelLabel}
        taskTagOptions={taskUi.taskTagOptions}
        setTaskCreator={taskUi.setTaskCreator}
        closeTaskCreator={taskUi.closeTaskCreator}
        generateTaskTitle={taskUi.generateTaskTitle}
        createTask={taskUi.createTask}
        taskEditor={taskUi.taskEditor}
        setTaskEditor={taskUi.setTaskEditor}
        closeTaskEditor={taskUi.closeTaskEditor}
        generateTaskEditorTitle={taskUi.generateTaskEditorTitle}
        saveTaskEdits={taskUi.saveTaskEdits}
        nodeDeleteConfirmation={taskUi.nodeDeleteConfirmation}
        setNodeDeleteConfirmation={taskUi.setNodeDeleteConfirmation}
        confirmNodeDelete={taskUi.confirmNodeDelete}
        spaceWorktreeMismatchDropWarning={spaceWorktreeMismatchDropWarning}
        cancelSpaceWorktreeMismatchDropWarning={cancelSpaceWorktreeMismatchDropWarning}
        continueSpaceWorktreeMismatchDropWarning={continueSpaceWorktreeMismatchDropWarning}
        agentSettings={agentSettings}
        onChangePreserveWindowSizesOnArrange={onChangePreserveWindowSizesOnArrange}
        workspacePath={workspacePath}
        worktreesRoot={worktreesRoot}
        onShowMessage={onShowMessage}
        onAppendSpaceArchiveRecord={onAppendSpaceArchiveRecord}
        updateSpaceDirectory={updateSpaceDirectory}
        getSpaceBlockingNodes={getSpaceBlockingNodes}
        closeNodesById={closeNodesById}
        {...roleUiProps}
      />
    </WorkspaceCanvasProviders>
  )
}
