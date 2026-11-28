import type { Edge, Node, ReactFlowInstance, Viewport } from '@xyflow/react'
import type { AgentSettings } from '@contexts/settings/domain/agentSettings'
import type { TerminalNodeData } from '../../../types'
import { useWorkspaceCanvasLifecycle } from './useLifecycle'
import { useFocusTargetZoomPreview } from './useFocusTargetZoomPreview'
import { useWorkspaceCanvasState } from './useCanvasState'
import { useWorkspaceCanvasViewportNavigation } from './useViewportNavigation'
import { useWorkspaceCanvasCreationActivation } from './useCreationActivation'

export function useWorkspaceCanvasLifecycleBindings({
  workspaceId,
  canvasState,
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
  requestNodeDelete,
}: {
  workspaceId: string
  canvasState: ReturnType<typeof useWorkspaceCanvasState>
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
  requestNodeDelete: (nodeIds: readonly string[]) => void
}): void {
  useWorkspaceCanvasCreationActivation({ workspaceId, canvasRef: canvasState.canvasRef })
  useWorkspaceCanvasViewportNavigation({
    canvasRef: canvasState.canvasRef,
    workspaceId,
    persistedViewport: viewport,
    restoredViewportWorkspaceIdRef: canvasState.restoredViewportWorkspaceIdRef,
    reactFlow,
    focusNodeId,
    focusNodeInput,
    focusSpaceId,
    focusSequence,
    nodes,
    expandNode,
    focusSpaceInViewport,
    focusNodeTargetZoom: agentSettings.focusNodeTargetZoom,
  })

  useWorkspaceCanvasLifecycle({
    workspaceId,
    selectionDraftRef: canvasState.selectionDraftRef,
    trackpadGestureLockRef: canvasState.trackpadGestureLockRef,
    setIsCanvasWheelGestureCaptureActive: canvasState.setIsCanvasWheelGestureCaptureActive,
    canvasInputModeSetting: agentSettings.canvasInputMode,
    inputModalityStateRef: canvasState.inputModalityStateRef,
    setDetectedCanvasInputMode: canvasState.setDetectedCanvasInputMode,
    isShiftPressedRef: canvasState.isShiftPressedRef,
    setIsShiftPressed: canvasState.setIsShiftPressed,
    requestNodeDelete,
  })
  useFocusTargetZoomPreview({
    reactFlow,
    focusNodeTargetZoom: agentSettings.focusNodeTargetZoom,
    isPreviewing: isFocusNodeTargetZoomPreviewing,
  })
}
