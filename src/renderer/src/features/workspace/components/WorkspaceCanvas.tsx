import React, { useCallback, useMemo, useRef, useState } from 'react'
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
import { useWorkspaceCanvasTaskCreator } from './workspaceCanvas/hooks/useTaskCreator'
import { useWorkspaceCanvasTaskDeleteConfirmation } from './workspaceCanvas/hooks/useTaskDeleteConfirmation'
import { useWorkspaceCanvasTaskEditor } from './workspaceCanvas/hooks/useTaskEditor'
import { useWorkspaceCanvasTrackpadGestures } from './workspaceCanvas/hooks/useTrackpadGestures'
import { useWorkspaceCanvasSpaceDrag } from './workspaceCanvas/hooks/useSpaceDrag'
import { useWorkspaceCanvasSpaces } from './workspaceCanvas/hooks/useSpaces'
import { useWorkspaceCanvasNodeTypes } from './workspaceCanvas/nodeTypes'
import { WorkspaceCanvasView } from './workspaceCanvas/WorkspaceCanvasView'
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
  nodes,
  onNodesChange,
  onRequestPersistFlush,
  spaces,
  activeSpaceId,
  onSpacesChange,
  onActiveSpaceChange,
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
    createNodeForSession,
    createTaskNode,
  } = useWorkspaceCanvasNodesStore({
    nodes,
    onNodesChange,
    onRequestPersistFlush,
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
    moveSelectionToSpace,
    removeSelectionFromSpaces,
    spaceVisuals,
    focusSpaceInViewport,
    focusAllInViewport,
  } = useWorkspaceCanvasSpaces({
    workspaceId,
    workspacePath,
    reactFlow,
    nodes,
    nodesRef,
    spaces,
    spacesRef,
    activeSpaceId,
    selectedNodeIds,
    selectedNodeIdsRef,
    onSpacesChange,
    onActiveSpaceChange,
    setContextMenu,
    setEmptySelectionPrompt,
  })

  const { spaceDragOffset, handleSpaceDragHandlePointerDown } = useWorkspaceCanvasSpaceDrag({
    workspaceId,
    reactFlow,
    nodesRef,
    spacesRef,
    setNodes,
    onSpacesChange,
    onActiveSpaceChange,
    setContextMenu,
    cancelSpaceRename,
    setEmptySelectionPrompt,
  })

  const { buildAgentNodeTitle, launchAgentInNode, stopAgentNode } =
    useWorkspaceCanvasAgentNodeLifecycle({
      nodesRef,
      setNodes,
      bumpAgentLaunchToken,
      isAgentLaunchTokenCurrent,
    })

  const {
    agentLauncher,
    setAgentLauncher,
    openAgentLauncher,
    closeAgentLauncher,
    launchAgentNode,
    launcherModelOptions,
  } = useWorkspaceCanvasAgentLauncher({
    agentSettings,
    workspacePath,
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
    setNodes,
    createNodeForSession,
    buildAgentNodeTitle,
    launchAgentInNode,
    agentSettings,
    workspacePath,
    taskTagOptions,
    onRequestPersistFlush,
    runTaskAgentRef: actionRefs.runTaskAgentRef,
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
    stopAgentNode,
    launchAgentInNode,
    updateNodeScrollback,
    updateTerminalTitle,
    renameTerminalTitle,
    normalizeZoomOnTerminalClick: agentSettings.normalizeZoomOnTerminalClick,
    nodesRef,
    reactFlow,
  })

  useWorkspaceCanvasPtyTaskCompletion({ setNodes })

  const nodeTypes = useWorkspaceCanvasNodeTypes({ nodesRef, ...actionRefs })

  const {
    clearNodeSelection,
    handleSelectionContextMenu,
    handleNodeContextMenu,
    handlePaneContextMenu,
    handleSelectionChange,
    handleCanvasPointerDownCapture,
    handleCanvasPointerMoveCapture,
    handleCanvasPointerUpCapture,
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
    nodesRef,
    createNodeForSession,
  })

  const applyChanges = useWorkspaceCanvasApplyNodeChanges({
    nodesRef,
    onNodesChange,
    clearAgentLaunchToken,
    normalizePosition,
    applyPendingScrollbacks,
    isNodeDraggingRef,
  })

  const taskTitleProviderLabel = AGENT_PROVIDER_LABEL[resolveTaskTitleProvider(agentSettings)]
  const taskTitleModelLabel = resolveTaskTitleModel(agentSettings) ?? 'default model'
  const handleViewportMoveEnd = useCallback(
    (_event: MouseEvent | TouchEvent | null, nextViewport: Viewport) => {
      const normalizedViewport = {
        x: nextViewport.x,
        y: nextViewport.y,
        zoom: nextViewport.zoom,
      }

      viewportRef.current = normalizedViewport
      onViewportChange(normalizedViewport)
    },
    [onViewportChange],
  )
  const minimapNodeColor = useCallback((node: Node<TerminalNodeData>): string => {
    switch (node.data.kind) {
      case 'agent':
        return 'rgba(111, 188, 255, 0.72)'
      case 'task':
        return 'rgba(168, 160, 255, 0.72)'
      default:
        return 'rgba(130, 156, 255, 0.72)'
    }
  }, [])

  const taskAssignerAgentOptions = useMemo(() => {
    const taskTitleById = new Map(
      nodes.filter(node => node.data.kind === 'task').map(node => [node.id, node.data.title]),
    )

    return nodes
      .filter(node => node.data.kind === 'agent' && node.data.agent)
      .map(node => ({
        nodeId: node.id,
        title: node.data.title,
        status: node.data.status,
        linkedTaskTitle: node.data.agent?.taskId
          ? (taskTitleById.get(node.data.agent.taskId) ?? null)
          : null,
      }))
  }, [nodes])

  const activeTaskForAssigner = useMemo(() => {
    if (!taskAssigner) {
      return null
    }

    return (
      nodes.find(node => node.id === taskAssigner.taskNodeId && node.data.kind === 'task') ?? null
    )
  }, [nodes, taskAssigner])

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
      onMoveEnd={handleViewportMoveEnd}
      viewport={viewport}
      isTrackpadCanvasMode={isTrackpadCanvasMode}
      isShiftPressed={isShiftPressed}
      spaceVisuals={spaceVisuals}
      activeSpaceId={activeSpaceId}
      spaceDragOffset={spaceDragOffset}
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
      onActiveSpaceChange={onActiveSpaceChange}
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
      moveSelectionToSpace={moveSelectionToSpace}
      removeSelectionFromSpaces={removeSelectionFromSpaces}
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
      agentLauncher={agentLauncher}
      agentSettings={agentSettings}
      workspacePath={workspacePath}
      launcherModelOptions={launcherModelOptions}
      setAgentLauncher={setAgentLauncher}
      closeAgentLauncher={closeAgentLauncher}
      launchAgentNode={launchAgentNode}
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
