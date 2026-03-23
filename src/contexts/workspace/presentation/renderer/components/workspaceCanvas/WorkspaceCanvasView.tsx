import React from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  PanOnScrollMode,
  ReactFlow,
  SelectionMode,
  useStoreApi,
  type Edge,
  type Node,
} from '@xyflow/react'
import { LABEL_COLORS, type LabelColor } from '@shared/types/labelColor'
import type { TerminalNodeData } from '../../types'
import { MAX_CANVAS_ZOOM, MIN_CANVAS_ZOOM } from './constants'
import type { WorkspaceCanvasViewProps } from './WorkspaceCanvasView.types'
import { WorkspaceContextMenu } from './view/WorkspaceContextMenu'
import { WorkspaceMinimapDock } from './view/WorkspaceMinimapDock'
import { WorkspaceSelectionDraftOverlay } from './view/WorkspaceSelectionDraftOverlay'
import { WorkspaceSpaceActionMenu } from './view/WorkspaceSpaceActionMenu'
import { WorkspaceCanvasTopOverlays } from './view/WorkspaceCanvasTopOverlays'
import { WorkspaceSpaceRegionsOverlay } from './view/WorkspaceSpaceRegionsOverlay'
import { useWorkspaceCanvasGlobalDismissals } from './hooks/useGlobalDismissals'
import { NodeDeleteConfirmationWindow } from './windows/NodeDeleteConfirmationWindow'
import { SpaceWorktreeMismatchDropWarningWindow } from './windows/SpaceWorktreeMismatchDropWarningWindow'
import { TaskCreatorWindow } from './windows/TaskCreatorWindow'
import { TaskEditorWindow } from './windows/TaskEditorWindow'
import { SpaceWorktreeWindow } from './windows/SpaceWorktreeWindow'

const WHEEL_BLOCK_SELECTOR = '.cove-window, .cove-window-backdrop, .workspace-context-menu'

type NodeWithEffectiveLabelColor = Node<TerminalNodeData> & {
  data: TerminalNodeData & { effectiveLabelColor?: LabelColor | null }
}
export function WorkspaceCanvasView({
  canvasRef,
  resolvedCanvasInputMode,
  onCanvasClick,
  handleCanvasPointerDownCapture,
  handleCanvasPointerMoveCapture,
  handleCanvasPointerUpCapture,
  handleCanvasDoubleClickCapture,
  handleCanvasWheelCapture,
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
  spaceVisuals,
  spaceFramePreview,
  selectedSpaceIds,
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
  focusSpaceInViewport,
  focusAllInViewport,
  contextMenu,
  closeContextMenu,
  createTerminalNode,
  createNoteNodeFromContextMenu,
  openTaskCreator,
  openAgentLauncher,
  openAgentLauncherForProvider,
  createSpaceFromSelectedNodes,
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
  updateSpaceDirectory,
  getSpaceBlockingNodes,
  closeNodesById,
}: WorkspaceCanvasViewProps): React.JSX.Element {
  const reactFlowStore = useStoreApi()
  const [labelColorFilter, setLabelColorFilter] = React.useState<LabelColor | null>(null)

  useWorkspaceCanvasGlobalDismissals({
    contextMenu,
    spaceActionMenu,
    closeContextMenu,
    canvasRef,
    selectedNodeCount,
    clearNodeSelection,
  })

  const inheritedLabelColorByNodeId = React.useMemo(() => {
    const map = new Map<string, LabelColor>()

    for (const space of spaces) {
      if (!space.labelColor) {
        continue
      }

      for (const nodeId of space.nodeIds) {
        if (!map.has(nodeId)) {
          map.set(nodeId, space.labelColor)
        }
      }
    }

    return map
  }, [spaces])

  const nodesWithEffectiveLabelColor = React.useMemo<NodeWithEffectiveLabelColor[]>(() => {
    return nodes.map(node => {
      const override = node.data.labelColorOverride ?? null
      const effectiveLabelColor: LabelColor | null =
        override === 'none'
          ? null
          : override
            ? override
            : (inheritedLabelColorByNodeId.get(node.id) ?? null)

      return {
        ...node,
        data: {
          ...node.data,
          effectiveLabelColor,
        },
      }
    })
  }, [inheritedLabelColorByNodeId, nodes])

  const usedLabelColors = React.useMemo(() => {
    const seen = new Set<LabelColor>()
    for (const node of nodesWithEffectiveLabelColor) {
      const color = node.data.effectiveLabelColor ?? null
      if (color) {
        seen.add(color)
      }
    }

    return LABEL_COLORS.filter(color => seen.has(color))
  }, [nodesWithEffectiveLabelColor])

  React.useEffect(() => {
    if (!labelColorFilter) {
      return
    }

    if (!usedLabelColors.includes(labelColorFilter)) {
      setLabelColorFilter(null)
    }
  }, [labelColorFilter, usedLabelColors])

  const filteredNodes = React.useMemo(() => {
    if (!labelColorFilter) {
      return nodesWithEffectiveLabelColor
    }

    return nodesWithEffectiveLabelColor.map(node => {
      const effectiveLabelColor = node.data.effectiveLabelColor ?? null
      if (effectiveLabelColor === labelColorFilter) {
        return node
      }

      const className =
        typeof node.className === 'string' && node.className.trim().length > 0
          ? `${node.className} cove-node--filtered-out`
          : 'cove-node--filtered-out'

      return {
        ...node,
        className,
        style: {
          ...node.style,
          pointerEvents: 'none' as const,
        },
        draggable: false,
        selectable: false,
        focusable: false,
      }
    })
  }, [labelColorFilter, nodesWithEffectiveLabelColor])

  const filteredEdges = React.useMemo(() => {
    if (!labelColorFilter) {
      return edges
    }

    const allowedNodeIds = new Set(
      nodesWithEffectiveLabelColor
        .filter(node => (node.data.effectiveLabelColor ?? null) === labelColorFilter)
        .map(node => node.id),
    )

    return edges.filter(edge => allowedNodeIds.has(edge.source) && allowedNodeIds.has(edge.target))
  }, [edges, labelColorFilter, nodesWithEffectiveLabelColor])

  const activeMenuSpace = React.useMemo(
    () =>
      spaceActionMenu
        ? (spaces.find(candidate => candidate.id === spaceActionMenu.spaceId) ?? null)
        : null,
    [spaceActionMenu, spaces],
  )

  const normalizedWorkspacePath = React.useMemo(
    () => normalizeComparablePath(workspacePath),
    [workspacePath],
  )

  const activeMenuSpacePath = React.useMemo(() => {
    if (!activeMenuSpace) {
      return workspacePath
    }

    const trimmed = activeMenuSpace.directoryPath.trim()
    return trimmed.length > 0 ? trimmed : workspacePath
  }, [activeMenuSpace, workspacePath])

  const isActiveMenuSpaceOnWorkspaceRoot =
    normalizeComparablePath(activeMenuSpacePath) === normalizedWorkspacePath

  return (
    <div
      ref={canvasRef}
      className="workspace-canvas"
      data-canvas-input-mode={resolvedCanvasInputMode}
      data-selected-node-count={selectedNodeCount}
      onClick={onCanvasClick}
      onDoubleClickCapture={handleCanvasDoubleClickCapture}
      onPointerDownCapture={event => {
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
      onWheelCapture={event => {
        if (event.target instanceof Element && event.target.closest(WHEEL_BLOCK_SELECTOR)) {
          return
        }
        handleCanvasWheelCapture(event.nativeEvent)
      }}
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

      <WorkspaceSelectionDraftOverlay canvasRef={canvasRef} draft={selectionDraft} />

      <WorkspaceCanvasTopOverlays
        spaces={spaces}
        focusSpaceInViewport={focusSpaceInViewport}
        focusAllInViewport={focusAllInViewport}
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
        openTaskCreator={openTaskCreator}
        openAgentLauncher={openAgentLauncher}
        agentProviderOrder={agentSettings.agentProviderOrder}
        openAgentLauncherForProvider={openAgentLauncherForProvider}
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
        canCreateWorktree={activeMenuSpace !== null && isActiveMenuSpaceOnWorkspaceRoot}
        canArchive={activeMenuSpace !== null}
        closeMenu={closeSpaceActionMenu}
        setSpaceLabelColor={setSpaceLabelColor}
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

      <TaskCreatorWindow
        taskCreator={taskCreator}
        taskTitleProviderLabel={taskTitleProviderLabel}
        taskTitleModelLabel={taskTitleModelLabel}
        taskTagOptions={taskTagOptions}
        setTaskCreator={setTaskCreator}
        closeTaskCreator={closeTaskCreator}
        generateTaskTitle={generateTaskTitle}
        createTask={createTask}
      />

      <TaskEditorWindow
        taskEditor={taskEditor}
        taskTitleProviderLabel={taskTitleProviderLabel}
        taskTitleModelLabel={taskTitleModelLabel}
        taskTagOptions={taskTagOptions}
        setTaskEditor={setTaskEditor}
        closeTaskEditor={closeTaskEditor}
        generateTaskEditorTitle={generateTaskEditorTitle}
        saveTaskEdits={saveTaskEdits}
      />

      <NodeDeleteConfirmationWindow
        nodeDeleteConfirmation={nodeDeleteConfirmation}
        setNodeDeleteConfirmation={setNodeDeleteConfirmation}
        confirmNodeDelete={confirmNodeDelete}
      />

      <SpaceWorktreeMismatchDropWarningWindow
        warning={spaceWorktreeMismatchDropWarning}
        onCancel={cancelSpaceWorktreeMismatchDropWarning}
        onContinue={continueSpaceWorktreeMismatchDropWarning}
      />

      <SpaceWorktreeWindow
        spaceId={spaceWorktreeDialog?.spaceId ?? null}
        initialViewMode={spaceWorktreeDialog?.initialViewMode ?? 'create'}
        spaces={spaces}
        nodes={nodes}
        workspacePath={workspacePath}
        worktreesRoot={worktreesRoot}
        agentSettings={agentSettings}
        onClose={closeSpaceWorktree}
        onShowMessage={onShowMessage}
        onUpdateSpaceDirectory={(spaceId, directoryPath, options) => {
          updateSpaceDirectory(spaceId, directoryPath, options)
        }}
        getBlockingNodes={spaceId => getSpaceBlockingNodes(spaceId)}
        closeNodesById={nodeIds => closeNodesById(nodeIds)}
      />
    </div>
  )
}

function normalizeComparablePath(pathValue: string): string {
  return pathValue.trim().replace(/\\/g, '/').replace(/\/+$/g, '').toLowerCase()
}
