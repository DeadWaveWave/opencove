import { useReactFlow, type Edge, type Node } from '@xyflow/react'
import * as workspaceCanvasHooks from './workspaceCanvas/hooks'
import { CanvasFlowHost } from './workspaceCanvas/CanvasFlowHost'
import { openQuickMenuSettings } from './workspaceCanvas/openQuickMenuSettings'
import type { WorkspaceCanvasInnerProps } from './workspaceCanvas/types'
import { useCanvasCollapse } from './workspaceCanvas/collapse/useCanvasCollapse'
import { WorkspaceCanvasProviders } from './workspaceCanvas/WorkspaceCanvasProviders'
import { useCanvasSpaceExplorer } from './workspaceCanvas/hooks/useCanvasSpaceExplorer'
import { useWorkspaceCanvasActionBar } from './workspaceCanvas/hooks/useCanvasActionBarActions'
import { useCanvasCommitProbe } from './shared/windowCommitProbe'
export function WorkspaceCanvasInner(props: WorkspaceCanvasInnerProps) {
  const {
    workspaceId,
    onShowMessage,
    workspacePath,
    environmentVariables,
    worktreesRoot,
    nodes,
    spaces,
    activeSpaceId,
    onActiveSpaceChange,
    onOpenSpaceContextMenu,
    shortcutsEnabled = true,
    onAppendSpaceArchiveRecord,
    viewport,
    isMinimapVisible,
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
  } = props
  useCanvasCommitProbe('WorkspaceCanvasInner', props)
  const reactFlow = useReactFlow<Node<import('../types').TerminalNodeData>, Edge>()
  const canvasState = workspaceCanvasHooks.useWorkspaceCanvasState({
    nodes,
    spaces,
    viewport,
  })
  const nodePublishers = workspaceCanvasHooks.useWorkspaceCanvasNodePublishers({ workspaceId })
  // prettier-ignore
  const exclusiveNodeDragAnchorIdRef = workspaceCanvasHooks.useWorkspaceCanvasWorkspaceReset(workspaceId, canvasState.selectedNodeIds.length)
  const actionRefs = workspaceCanvasHooks.useWorkspaceCanvasActionRefs()
  const nodeStore = workspaceCanvasHooks.useWorkspaceCanvasNodesStore({
    workspaceId,
    workspacePath,
    nodes: canvasState.flowNodes,
    onNodesCommitted: nodePublishers.publishCommittedNodes,
    isLiveGestureActive: nodePublishers.isLiveGestureActive,
    onShowMessage,
    standardWindowSizeBucket: agentSettings.standardWindowSizeBucket,
    browserDefaultMode: agentSettings.browserDefaultMode,
  })
  const nodeDragSession = workspaceCanvasHooks.useWorkspaceCanvasNodeDragSession({ workspaceId })
  // prettier-ignore
  const { updateSpaceDirectory, getSpaceBlockingNodes, closeNodesById } = workspaceCanvasHooks.useWorkspaceCanvasSpaceDirectoryOps({ workspacePath, updateCanvasDocument: nodeStore.updateCanvasDocument, closeNode: nodeStore.closeNode })
  const spacesApi = workspaceCanvasHooks.useWorkspaceCanvasSpaces({
    workspaceId,
    activeSpaceId,
    onActiveSpaceChange,
    workspacePath,
    focusNodeTargetZoom: agentSettings.focusNodeTargetZoom,
    standardWindowSizeBucket: agentSettings.standardWindowSizeBucket,
    reactFlow,
    nodes: canvasState.flowNodes,
    updateCanvasDocument: nodeStore.updateCanvasDocument,
    spaces,
    onShowMessage,
  })
  const { spaceFramePreview, handleSpaceDragHandlePointerDown } =
    workspaceCanvasHooks.useWorkspaceCanvasSpaceDrag({
      workspaceId,
      reactFlow,
      setNodes: nodeStore.setNodes,
      updateCanvasDocument: nodeStore.updateCanvasDocument,
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
    nodeDragSession,
    exclusiveNodeDragAnchorIdRef,
    setNodes: nodeStore.setNodes,
    updateCanvasDocument: nodeStore.updateCanvasDocument,
    onShowMessage,
    hideWorktreeMismatchDropWarning: agentSettings.hideWorktreeMismatchDropWarning === true,
    nodeDragPointerAnchorRef: nodeDragSession.nodeDragPointerAnchorRef,
  })
  const agentSupport = workspaceCanvasHooks.useWorkspaceCanvasAgentSupport({
    setNodes: nodeStore.setNodes,
    bumpAgentLaunchToken: nodeStore.bumpAgentLaunchToken,
    isAgentLaunchTokenCurrent: nodeStore.isAgentLaunchTokenCurrent,
    agentSettings,
    workspaceId,
    workspacePath,
    environmentVariables,
    updateCanvasDocument: nodeStore.updateCanvasDocument,
    onShowMessage,
    createNodeForSession: nodeStore.createNodeForSession,
    standardWindowSizeBucket: agentSettings.standardWindowSizeBucket,
    terminalDisplayMetrics,
  })
  const taskUi = workspaceCanvasHooks.useWorkspaceCanvasTaskUi({
    agentTaskTagOptions: agentSettings.taskTagOptions,
    setNodes: nodeStore.setNodes,
    updateCanvasDocument: nodeStore.updateCanvasDocument,
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
  const roleUiProps = workspaceCanvasHooks.useWorkspaceCanvasRoleUi({ workspaceId, workspacePath, environmentVariables, agentSettings, nodeStore, agentSupport, onShowMessage, actionRefs })
  // prettier-ignore
  const inputMode = workspaceCanvasHooks.useWorkspaceCanvasInputMode({ canvasInputModeSetting: agentSettings.canvasInputMode, canvasWheelBehaviorSetting: agentSettings.canvasWheelBehavior, canvasWheelZoomModifierSetting: agentSettings.canvasWheelZoomModifier, detectedCanvasInputMode: canvasState.detectedCanvasInputMode, inputModalityStateRef: canvasState.inputModalityStateRef, setDetectedCanvasInputMode: canvasState.setDetectedCanvasInputMode, canvasRef: canvasState.canvasRef, trackpadGestureLockRef: canvasState.trackpadGestureLockRef, setIsCanvasWheelGestureCaptureActive: canvasState.setIsCanvasWheelGestureCaptureActive, viewportRef: canvasState.viewportRef, reactFlow, onViewportChange })
  // Committed nodes feed collapse read models; the actions plan from the committed document.
  // prettier-ignore
  const collapse = useCanvasCollapse({ workspaceId, canvasRef: canvasState.canvasRef, nodes, spaces, updateCanvasDocument: nodeStore.updateCanvasDocument, reactFlow, focusNodeTargetZoom: agentSettings.focusNodeTargetZoom, nodeExpandBehavior: agentSettings.nodeExpandBehavior })
  // prettier-ignore
  workspaceCanvasHooks.useWorkspaceCanvasLifecycleBindings({ workspaceId, canvasState, reactFlow, viewport, agentSettings, focusSpaceId, focusNodeId, focusNodeInput, focusSequence, expandNode: collapse.expandNode, focusSpaceInViewport: spacesApi.focusSpaceInViewport, nodes: canvasState.flowNodes, isFocusNodeTargetZoomPreviewing, requestNodeDeleteRef: actionRefs.requestNodeDeleteRef })
  // prettier-ignore
  const { canConvertSelectedNoteToTask, isConvertSelectedNoteToTaskDisabled, convertSelectedNoteToTask, convertNoteToTask, arrangeAll, arrangeCanvas, arrangeInSpace } = workspaceCanvasHooks.useWorkspaceCanvasMenuActions({ selectedNodeIds: canvasState.selectedNodeIds, flowNodes: canvasState.flowNodes, updateCanvasDocument: nodeStore.updateCanvasDocument, onShowMessage, reactFlow, standardWindowSizeBucket: agentSettings.standardWindowSizeBucket, focusNodeTargetZoom: agentSettings.focusNodeTargetZoom })
  const { nodeTypes, nodeTypesParameters } =
    workspaceCanvasHooks.useWorkspaceCanvasComposedNodeTypes({
      nodeStore,
      workspacePath,
      onShowMessage,
      agentSettings,
      actionRefs,
      convertNoteToTask,
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
    reactFlow,
    setNodes: nodeStore.setNodes,
    updateCanvasDocument: nodeStore.updateCanvasDocument,
    workspaceId,
    workspacePath,
    environmentVariables,
    defaultTerminalProfileId: agentSettings.defaultTerminalProfileId,
    terminalFontSize: agentSettings.terminalFontSize,
    terminalDisplayMetrics,
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
  })
  const createPluginNodeFromContextMenu = workspaceCanvasHooks.useWorkspaceCanvasPluginEntry({
    createPluginNode: nodeStore.createPluginNode,
  })
  workspaceCanvasHooks.useWorkspaceCanvasShortcutActions({
    closeNode: taskUi.requestNodeClose,
    enabled: shortcutsEnabled,
    workspaceId,
    activeSpaceId,
    agentSettings,
    workspacePath,
    environmentVariables,
    canvasRef: canvasState.canvasRef,
    reactFlow,
    spaceNavigationAnchorIdRef: canvasState.spaceNavigationAnchorIdRef,
    setNodes: nodeStore.setNodes,
    updateCanvasDocument: nodeStore.updateCanvasDocument,
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
    workspaceId,
    actionRefs,
    nodeStore,
    taskUi,
    agentSupport,
    agentSettings,
    reactFlow,
    clearNodeSelection,
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
    workspacePath,
    handlePaneClick,
    handlePaneContextMenu,
    handleNodeContextMenu,
    handleSelectionContextMenu,
  })
  // prettier-ignore
  const spaceExplorer = useCanvasSpaceExplorer({ workspaceId, canvasState, nodeStore, spaces, reactFlow, nodeDragSession, finalizeDraggedNodeDrop, agentSettings, expandNode: collapse.expandNode })
  return (
    <WorkspaceCanvasProviders
      nodeTypesParameters={nodeTypesParameters}
      collapse={collapse}
      openSpaceExplorer={spaceExplorer.openSpaceExplorer}
      openExplorerSpaceId={spaceExplorer.openExplorerSpaceId}
      workspaceId={workspaceId}
      workspacePath={workspacePath}
      nodeStore={nodeStore}
      onShowMessage={onShowMessage}
    >
      <CanvasFlowHost
        workspaceId={workspaceId}
        terminalFontSize={agentSettings.terminalFontSize}
        terminalFontFamily={agentSettings.terminalFontFamily}
        terminalBackground={agentSettings.terminalBackground}
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
        committedNodes={canvasState.flowNodes}
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
        spaceVisuals={spacesApi.spaceVisuals}
        spaceDragFramePreview={spaceFramePreview}
        handleSpaceDragHandlePointerDown={handleSpaceDragHandlePointerDown}
        commitSpaceRename={spacesApi.commitSpaceRename}
        activateSpaceTitle={spacesApi.activateSpaceTitle}
        setSpaceLabelColor={spacesApi.setSpaceLabelColor}
        selectedNodeCount={canvasState.selectedNodeIds.length}
        isMinimapVisible={isMinimapVisible}
        minimapNodeColor={minimapNodeColor}
        onMinimapVisibilityChange={onMinimapVisibilityChange}
        spaces={spaces}
        activateSpace={spacesApi.activateSpace}
        activateAllSpaces={spacesApi.activateAllSpaces}
        onOpenSpaceContextMenu={onOpenSpaceContextMenu}
        createTerminalNode={createTerminalNode}
        createNoteNodeFromContextMenu={createNoteNodeFromContextMenu}
        createWebsiteNodeFromContextMenu={createWebsiteNodeFromContextMenu}
        createPluginNodeFromContextMenu={createPluginNodeFromContextMenu}
        arrangeAll={arrangeAll}
        arrangeCanvas={arrangeCanvas}
        arrangeInSpace={arrangeInSpace}
        createTaskFromContextMenu={taskUi.createTaskFromContextMenu}
        openAgentLauncher={agentSupport.openAgentLauncher}
        openAgentLauncherForProvider={agentSupport.openAgentLauncherForProvider}
        runQuickCommand={runQuickCommand}
        insertQuickPhrase={insertQuickPhrase}
        openQuickMenuSettings={openQuickMenuSettings}
        createSpaceFromSelectedNodes={spacesApi.createSpaceFromSelectedNodes}
        createChildSpaceInParent={spacesApi.createChildSpaceInParent}
        createEmptySpaceAtPoint={spacesApi.createEmptySpaceAtPoint}
        confirmSpaceTargetMountPicker={spacesApi.confirmSpaceTargetMountPicker}
        cancelSpaceTargetMountPicker={spacesApi.cancelSpaceTargetMountPicker}
        clearNodeSelection={clearNodeSelection}
        canConvertSelectedNoteToTask={canConvertSelectedNoteToTask}
        isConvertSelectedNoteToTaskDisabled={isConvertSelectedNoteToTaskDisabled}
        convertSelectedNoteToTask={convertSelectedNoteToTask}
        setSelectedNodeLabelColorOverride={override =>
          nodeStore.setNodeLabelColorOverride(canvasState.selectedNodeIds, override)
        }
        taskTitleProviderLabel={taskTitleProviderLabel}
        taskTitleModelLabel={taskTitleModelLabel}
        taskTagOptions={taskUi.taskTagOptions}
        closeTaskEditor={taskUi.closeTaskEditor}
        generateTaskEditorTitle={taskUi.generateTaskEditorTitle}
        saveTaskEdits={taskUi.saveTaskEdits}
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
