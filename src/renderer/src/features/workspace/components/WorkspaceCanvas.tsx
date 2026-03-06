import React, { useMemo, useRef, useState } from 'react'
import { ReactFlowProvider, useReactFlow, type Edge, type Node, type Viewport } from '@xyflow/react'
import {
  AGENT_PROVIDER_LABEL,
  resolveTaskTitleModel,
  resolveTaskTitleProvider,
} from '../../settings/agentConfig'
import type { TerminalNodeData } from '../types'
import {
  createCanvasInputModalityState,
  type DetectedCanvasInputMode,
} from '../utils/inputModality'
import { useWorkspaceCanvasAgentNodeLifecycle } from './workspaceCanvas/hooks/useAgentNodeLifecycle'
import { useWorkspaceCanvasAgentLauncher } from './workspaceCanvas/hooks/useAgentLauncher'
import {
  useWorkspaceCanvasActionRefs,
  useWorkspaceCanvasSyncActionRefs,
} from './workspaceCanvas/hooks/useActionRefs'
import { useWorkspaceCanvasApplyNodeChanges } from './workspaceCanvas/hooks/useApplyNodeChanges'
import { useWorkspaceCanvasInteractions } from './workspaceCanvas/hooks/useInteractions'
import { useWorkspaceCanvasLifecycle } from './workspaceCanvas/hooks/useLifecycle'
import { useWorkspaceCanvasNodesStore } from './workspaceCanvas/hooks/useNodesStore'
import { useWorkspaceCanvasPtyTaskCompletion } from './workspaceCanvas/hooks/usePtyTaskCompletion'
import { useWorkspaceCanvasTaskAgentEdges } from './workspaceCanvas/hooks/useTaskAgentEdges'
import { useWorkspaceCanvasTaskActions } from './workspaceCanvas/hooks/useTaskActions'
import { useWorkspaceCanvasTaskAssigner } from './workspaceCanvas/hooks/useTaskAssigner'
import { useWorkspaceCanvasTaskAssignerOptions } from './workspaceCanvas/hooks/useTaskAssignerOptions'
import { useWorkspaceCanvasTaskCreator } from './workspaceCanvas/hooks/useTaskCreator'
import { useWorkspaceCanvasTaskDeleteConfirmation } from './workspaceCanvas/hooks/useTaskDeleteConfirmation'
import { useWorkspaceCanvasTaskEditor } from './workspaceCanvas/hooks/useTaskEditor'
import { useWorkspaceCanvasTrackpadGestures } from './workspaceCanvas/hooks/useTrackpadGestures'
import { useWorkspaceCanvasSpaceDrag } from './workspaceCanvas/hooks/useSpaceDrag'
import { useWorkspaceCanvasSpaceDirectoryOps } from './workspaceCanvas/hooks/useSpaceDirectoryOps'
import { useWorkspaceCanvasSpaceOwnership } from './workspaceCanvas/hooks/useSpaceOwnership'
import { useWorkspaceCanvasSpaces } from './workspaceCanvas/hooks/useSpaces'
import { useWorkspaceCanvasSelectNode } from './workspaceCanvas/hooks/useSelectNode'
import { useWorkspaceCanvasViewportMoveEnd } from './workspaceCanvas/hooks/useViewportMoveEnd'
import { useWorkspaceCanvasNodeTypes } from './workspaceCanvas/nodeTypes'
import { WorkspaceCanvasView } from './workspaceCanvas/WorkspaceCanvasView'
import { resolveWorkspaceMinimapNodeColor } from './workspaceCanvas/minimap'
import type {
  ContextMenuState,
  EmptySelectionPromptState,
  SelectionDraftState,
  TrackpadGestureLockState,
  WorkspaceCanvasProps,
} from './workspaceCanvas/types'
function WorkspaceCanvasInner({
  workspaceId,
  workspacePath,
  worktreesRoot,
  nodes,
  onNodesChange,
  onRequestPersistFlush,
  spaces,
  onSpacesChange,
  viewport,
  isMinimapVisible: persistedMinimapVisible,
  onViewportChange,
  onMinimapVisibilityChange,
  agentSettings,
  focusNodeId,
  focusSequence,
}: WorkspaceCanvasProps): React.JSX.Element {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [isMinimapVisible, setIsMinimapVisible] = useState(persistedMinimapVisible)
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([])
  const [, setEmptySelectionPrompt] = useState<EmptySelectionPromptState | null>(null)
  const [detectedCanvasInputMode, setDetectedCanvasInputMode] =
    useState<DetectedCanvasInputMode>('mouse')
  const [isShiftPressed, setIsShiftPressed] = useState(false)
  const reactFlow = useReactFlow<Node<TerminalNodeData>, Edge>()
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const restoredViewportWorkspaceIdRef = useRef<string | null>(null)
  const spacesRef = useRef(spaces)
  const selectedNodeIdsRef = useRef<string[]>([])
  const selectionDraftRef = useRef<SelectionDraftState | null>(null)
  const actionRefs = useWorkspaceCanvasActionRefs()
  const inputModalityStateRef = useRef(createCanvasInputModalityState('mouse'))
  const isShiftPressedRef = useRef(false)
  const trackpadGestureLockRef = useRef<TrackpadGestureLockState | null>(null)
  const viewportRef = useRef<Viewport>(viewport)
  const [spaceWorktreeSpaceId, setSpaceWorktreeSpaceId] = useState<string | null>(null)
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
  } = useWorkspaceCanvasNodesStore({
    nodes,
    spacesRef,
    onNodesChange,
    onSpacesChange,
    onRequestPersistFlush,
    defaultTerminalWindowScalePercent: agentSettings.defaultTerminalWindowScalePercent,
  })
  const { updateSpaceDirectory, getSpaceBlockingNodes, closeNodesById } =
    useWorkspaceCanvasSpaceDirectoryOps({
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
  } = useWorkspaceCanvasSpaces({
    workspaceId,
    workspacePath,
    reactFlow,
    nodes,
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
  })
  const { spaceFramePreview, handleSpaceDragHandlePointerDown } = useWorkspaceCanvasSpaceDrag({
    workspaceId,
    reactFlow,
    nodesRef,
    spacesRef,
    setNodes,
    onSpacesChange,
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
  } = useWorkspaceCanvasSpaceOwnership({
    workspacePath,
    reactFlow,
    spacesRef,
    setNodes,
    onSpacesChange,
    onRequestPersistFlush,
  })

  const { buildAgentNodeTitle, launchAgentInNode } = useWorkspaceCanvasAgentNodeLifecycle({
    nodesRef,
    setNodes,
    bumpAgentLaunchToken,
    isAgentLaunchTokenCurrent,
    agentFullAccess: agentSettings.agentFullAccess,
  })

  const { openAgentLauncher } = useWorkspaceCanvasAgentLauncher({
    agentSettings,
    workspacePath,
    nodesRef,
    setNodes,
    spacesRef,
    onSpacesChange,
    onRequestPersistFlush,
    contextMenu,
    setContextMenu,
    createNodeForSession,
    buildAgentNodeTitle,
  })
  const taskTagOptions = useMemo(() => {
    const fromSettings = agentSettings.taskTagOptions ?? []
    return [...new Set(fromSettings.map(tag => tag.trim()).filter(tag => tag.length > 0))]
  }, [agentSettings.taskTagOptions])
  const { suggestTaskTitle } = useWorkspaceCanvasTaskActions({
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
  } = useWorkspaceCanvasTaskCreator({
    contextMenu,
    setContextMenu,
    taskTagOptions,
    nodesRef,
    setNodes,
    spacesRef,
    onSpacesChange,
    onRequestPersistFlush,
    suggestTaskTitle,
    createTaskNode,
  })
  const { taskEditor, setTaskEditor, closeTaskEditor, generateTaskEditorTitle, saveTaskEdits } =
    useWorkspaceCanvasTaskEditor({
      nodesRef,
      setNodes,
      onRequestPersistFlush,
      setContextMenu,
      suggestTaskTitle,
      taskTagOptions,
      openTaskEditorRef: actionRefs.openTaskEditorRef,
    })
  const { taskAssigner, setTaskAssigner, closeTaskAssigner, applyTaskAssignment } =
    useWorkspaceCanvasTaskAssigner({
      nodesRef,
      spacesRef,
      onSpacesChange,
      setNodes,
      onRequestPersistFlush,
      setContextMenu,
      openTaskAssignerRef: actionRefs.openTaskAssignerRef,
    })
  const { taskDeleteConfirmation, setTaskDeleteConfirmation, confirmTaskDelete } =
    useWorkspaceCanvasTaskDeleteConfirmation({
      nodesRef,
      closeNode,
      requestTaskDeleteRef: actionRefs.requestTaskDeleteRef,
    })
  const resolvedCanvasInputMode = useMemo<DetectedCanvasInputMode>(() => {
    if (agentSettings.canvasInputMode === 'auto') {
      return detectedCanvasInputMode
    }

    return agentSettings.canvasInputMode
  }, [agentSettings.canvasInputMode, detectedCanvasInputMode])

  const isTrackpadCanvasMode = resolvedCanvasInputMode === 'trackpad'

  const { handleCanvasWheelCapture } = useWorkspaceCanvasTrackpadGestures({
    canvasInputModeSetting: agentSettings.canvasInputMode,
    resolvedCanvasInputMode,
    inputModalityStateRef,
    setDetectedCanvasInputMode,
    canvasRef,
    trackpadGestureLockRef,
    viewportRef,
    reactFlow,
    onViewportChange,
  })

  useWorkspaceCanvasLifecycle({
    workspaceId,
    persistedMinimapVisible,
    setIsMinimapVisible,
    setSelectedNodeIds,
    setContextMenu,
    setEmptySelectionPrompt,
    cancelSpaceRename,
    selectionDraftRef,
    trackpadGestureLockRef,
    restoredViewportWorkspaceIdRef,
    reactFlow,
    viewport,
    viewportRef,
    canvasInputModeSetting: agentSettings.canvasInputMode,
    inputModalityStateRef,
    setDetectedCanvasInputMode,
    isShiftPressedRef,
    setIsShiftPressed,
    focusNodeId,
    focusSequence,
    nodesRef,
  })

  useWorkspaceCanvasSyncActionRefs({
    actionRefs,
    closeNode,
    resizeNode,
    updateNoteText,
    updateNodeScrollback,
    updateTerminalTitle,
    renameTerminalTitle,
    normalizeZoomOnTerminalClick: agentSettings.normalizeZoomOnTerminalClick,
    nodesRef,
    reactFlow,
  })

  useWorkspaceCanvasPtyTaskCompletion({
    setNodes,
    onRequestPersistFlush,
  })

  const selectNode = useWorkspaceCanvasSelectNode({ setNodes, setSelectedNodeIds })

  const nodeTypes = useWorkspaceCanvasNodeTypes({
    nodesRef,
    spacesRef,
    workspacePath,
    terminalFontSize: agentSettings.terminalFontSize,
    selectNode,
    ...actionRefs,
  })

  const {
    clearNodeSelection,
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
  } = useWorkspaceCanvasInteractions({
    isTrackpadCanvasMode,
    isShiftPressedRef,
    selectionDraftRef,
    reactFlow,
    setNodes,
    setSelectedNodeIds,
    setContextMenu,
    setEmptySelectionPrompt,
    cancelSpaceRename,
    selectedNodeIdsRef,
    contextMenu,
    workspacePath,
    spacesRef,
    onSpacesChange,
    nodesRef,
    createNodeForSession,
    createNoteNode,
  })
  const applyChanges = useWorkspaceCanvasApplyNodeChanges({
    nodesRef,
    onNodesChange,
    clearAgentLaunchToken,
    normalizePosition,
    applyPendingScrollbacks,
    isNodeDraggingRef,
  })

  const taskTitleProviderLabel = AGENT_PROVIDER_LABEL[resolveTaskTitleProvider(agentSettings)],
    taskTitleModelLabel = resolveTaskTitleModel(agentSettings) ?? 'default model'
  const handleViewportMoveEnd = useWorkspaceCanvasViewportMoveEnd({ viewportRef, onViewportChange })
  const minimapNodeColor = resolveWorkspaceMinimapNodeColor

  const { taskAssignerAgentOptions, activeTaskForAssigner } = useWorkspaceCanvasTaskAssignerOptions(
    {
      nodes,
      taskAssigner,
    },
  )

  const taskAgentEdges = useWorkspaceCanvasTaskAgentEdges(nodes)

  return (
    <WorkspaceCanvasView
      canvasRef={canvasRef}
      resolvedCanvasInputMode={resolvedCanvasInputMode}
      onCanvasClick={() => {
        setContextMenu(null)
        setEmptySelectionPrompt(null)
        cancelSpaceRename()
      }}
      handleCanvasPointerDownCapture={handleCanvasPointerDownCapture}
      handleCanvasPointerMoveCapture={handleCanvasPointerMoveCapture}
      handleCanvasPointerUpCapture={handleCanvasPointerUpCapture}
      handleCanvasDoubleClickCapture={handleCanvasDoubleClickCapture}
      handleCanvasWheelCapture={handleCanvasWheelCapture}
      nodes={nodes}
      edges={taskAgentEdges}
      nodeTypes={nodeTypes}
      onNodesChange={applyChanges}
      onPaneClick={handlePaneClick}
      onPaneContextMenu={handlePaneContextMenu}
      onNodeContextMenu={handleNodeContextMenu}
      onSelectionContextMenu={handleSelectionContextMenu}
      onSelectionChange={handleSelectionChange}
      onNodeDragStart={handleNodeDragStart}
      onSelectionDragStart={handleSelectionDragStart}
      onNodeDragStop={handleNodeDragStop}
      onSelectionDragStop={handleSelectionDragStop}
      onMoveEnd={handleViewportMoveEnd}
      viewport={viewport}
      isTrackpadCanvasMode={isTrackpadCanvasMode}
      isShiftPressed={isShiftPressed}
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
      selectedNodeCount={selectedNodeIds.length}
      isMinimapVisible={isMinimapVisible}
      minimapNodeColor={minimapNodeColor}
      setIsMinimapVisible={setIsMinimapVisible}
      onMinimapVisibilityChange={onMinimapVisibilityChange}
      spaces={spaces}
      focusSpaceInViewport={focusSpaceInViewport}
      focusAllInViewport={focusAllInViewport}
      contextMenu={contextMenu}
      closeContextMenu={() => {
        setContextMenu(null)
      }}
      createTerminalNode={createTerminalNode}
      openTaskCreator={openTaskCreator}
      openAgentLauncher={openAgentLauncher}
      createSpaceFromSelectedNodes={createSpaceFromSelectedNodes}
      clearNodeSelection={clearNodeSelection}
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
      taskAssigner={taskAssigner}
      activeTaskTitleForAssigner={activeTaskForAssigner?.data.title ?? null}
      taskAssignerAgentOptions={taskAssignerAgentOptions}
      setTaskAssigner={setTaskAssigner}
      closeTaskAssigner={closeTaskAssigner}
      applyTaskAssignment={applyTaskAssignment}
      taskDeleteConfirmation={taskDeleteConfirmation}
      setTaskDeleteConfirmation={setTaskDeleteConfirmation}
      confirmTaskDelete={confirmTaskDelete}
      agentSettings={agentSettings}
      workspacePath={workspacePath}
      spaceWorktreeSpaceId={spaceWorktreeSpaceId}
      worktreesRoot={worktreesRoot}
      openSpaceWorktree={spaceId => setSpaceWorktreeSpaceId(spaceId)}
      closeSpaceWorktree={() => setSpaceWorktreeSpaceId(null)}
      updateSpaceDirectory={updateSpaceDirectory}
      getSpaceBlockingNodes={getSpaceBlockingNodes}
      closeNodesById={closeNodesById}
    />
  )
}
export function WorkspaceCanvas(props: WorkspaceCanvasProps): React.JSX.Element {
  return (
    <ReactFlowProvider>
      <WorkspaceCanvasInner {...props} />
    </ReactFlowProvider>
  )
}
