import type { Edge, Node, ReactFlowInstance, Viewport } from '@xyflow/react'
import type { AgentSettings } from '@contexts/settings/domain/agentSettings'
import type { TerminalNodeData } from '../../../types'
import type { WorkspaceCanvasActionRefs } from './useActionRefs'
import { useWorkspaceCanvasLifecycle } from './useLifecycle'
import { useWorkspaceCanvasState } from './useCanvasState'
import { useWorkspaceCanvasViewportNavigation } from './useViewportNavigation'
import { useWorkspaceCanvasCreationActivation } from './useCreationActivation'

export function useWorkspaceCanvasLifecycleBindings({
  workspaceId,
  persistedMinimapVisible,
  canvasState,
  cancelSpaceRename,
  reactFlow,
  viewport,
  agentSettings,
  focusSpaceId,
  focusNodeId,
  focusNodeInput,
  focusSequence,
  expandNode,
  focusSpaceInViewport,
  nodes,
  isFocusNodeTargetZoomPreviewing,
  nodesRef,
  requestNodeDeleteRef,
}: {
  workspaceId: string
  persistedMinimapVisible: boolean
  canvasState: ReturnType<typeof useWorkspaceCanvasState>
  cancelSpaceRename: () => void
  reactFlow: ReactFlowInstance<Node<TerminalNodeData>, Edge>
  viewport: Viewport
  agentSettings: Pick<AgentSettings, 'canvasInputMode' | 'focusNodeTargetZoom'>
  focusSpaceId?: string | null
  focusNodeId?: string | null
  focusNodeInput?: boolean
  focusSequence?: number
  expandNode: (id: string) => Node<TerminalNodeData> | undefined
  focusSpaceInViewport: (spaceId: string) => boolean
  nodes: Node<TerminalNodeData>[]
  isFocusNodeTargetZoomPreviewing: boolean
  nodesRef: React.MutableRefObject<Node<TerminalNodeData>[]>
  requestNodeDeleteRef: WorkspaceCanvasActionRefs['requestNodeDeleteRef']
}): void {
  useWorkspaceCanvasCreationActivation({ workspaceId, canvasRef: canvasState.canvasRef, nodesRef })
  useWorkspaceCanvasViewportNavigation({
    workspaceId,
    persistedViewport: viewport,
    restoredViewportWorkspaceIdRef: canvasState.restoredViewportWorkspaceIdRef,
    reactFlow,
    focusNodeId,
    focusNodeInput,
    focusSpaceId,
    focusSequence,
    nodes,
    nodesRef,
    expandNode,
    focusSpaceInViewport,
    focusNodeTargetZoom: agentSettings.focusNodeTargetZoom,
  })

  useWorkspaceCanvasLifecycle({
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
    setIsCanvasWheelGestureCaptureActive: canvasState.setIsCanvasWheelGestureCaptureActive,
    reactFlow,
    viewport,
    viewportRef: canvasState.viewportRef,
    canvasInputModeSetting: agentSettings.canvasInputMode,
    inputModalityStateRef: canvasState.inputModalityStateRef,
    setDetectedCanvasInputMode: canvasState.setDetectedCanvasInputMode,
    isShiftPressedRef: canvasState.isShiftPressedRef,
    setIsShiftPressed: canvasState.setIsShiftPressed,
    selectedNodeIdsRef: canvasState.selectedNodeIdsRef,
    requestNodeDeleteRef,
    focusNodeTargetZoom: agentSettings.focusNodeTargetZoom,
    isFocusNodeTargetZoomPreviewing,
  })
}
