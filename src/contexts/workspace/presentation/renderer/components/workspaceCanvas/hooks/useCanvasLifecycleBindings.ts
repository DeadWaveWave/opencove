import type { Edge, Node, ReactFlowInstance, Viewport } from '@xyflow/react'
import type { AgentSettings } from '@contexts/settings/domain/agentSettings'
import type { TerminalNodeData } from '../../../types'
import type { WorkspaceCanvasActionRefs } from './useActionRefs'
import { useWorkspaceCanvasLifecycle } from './useLifecycle'
import { useWorkspaceCanvasState } from './useCanvasState'

export function useWorkspaceCanvasLifecycleBindings({
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
  requestNodeDeleteRef,
}: {
  workspaceId: string
  persistedMinimapVisible: boolean
  canvasState: ReturnType<typeof useWorkspaceCanvasState>
  cancelSpaceRename: () => void
  reactFlow: ReactFlowInstance<Node<TerminalNodeData>, Edge>
  viewport: Viewport
  agentSettings: Pick<AgentSettings, 'canvasInputMode' | 'focusNodeTargetZoom'>
  focusNodeId?: string | null
  focusSequence?: number
  isFocusNodeTargetZoomPreviewing: boolean
  nodesRef: React.MutableRefObject<Node<TerminalNodeData>[]>
  requestNodeDeleteRef: WorkspaceCanvasActionRefs['requestNodeDeleteRef']
}): void {
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
    requestNodeDeleteRef,
    focusNodeId,
    focusSequence,
    focusNodeTargetZoom: agentSettings.focusNodeTargetZoom,
    isFocusNodeTargetZoomPreviewing,
    nodesRef,
  })
}
