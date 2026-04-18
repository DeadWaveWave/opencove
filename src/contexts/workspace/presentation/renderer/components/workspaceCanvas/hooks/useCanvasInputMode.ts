import type { MutableRefObject } from 'react'
import type { Node, ReactFlowInstance, Viewport } from '@xyflow/react'
import type {
  CanvasWheelBehavior,
  CanvasWheelZoomModifier,
} from '@contexts/settings/domain/agentSettings'
import type {
  CanvasInputModalityState,
  DetectedCanvasInputMode,
} from '../../../utils/inputModality'
import type { TerminalNodeData } from '../../../types'
import type { TrackpadGestureLockState } from '../types'
import { useWorkspaceCanvasTrackpadGestures } from './useTrackpadGestures'

interface UseWorkspaceCanvasInputModeParams {
  canvasInputModeSetting: 'mouse' | 'trackpad' | 'auto'
  canvasWheelBehaviorSetting: CanvasWheelBehavior
  canvasWheelZoomModifierSetting: CanvasWheelZoomModifier
  detectedCanvasInputMode: DetectedCanvasInputMode
  inputModalityStateRef: MutableRefObject<CanvasInputModalityState>
  setDetectedCanvasInputMode: React.Dispatch<React.SetStateAction<DetectedCanvasInputMode>>
  canvasRef: MutableRefObject<HTMLDivElement | null>
  trackpadGestureLockRef: MutableRefObject<TrackpadGestureLockState | null>
  viewportRef: MutableRefObject<Viewport>
  reactFlow: ReactFlowInstance<Node<TerminalNodeData>>
  onViewportChange: (viewport: { x: number; y: number; zoom: number }) => void
}

export function useWorkspaceCanvasInputMode({
  canvasInputModeSetting,
  canvasWheelBehaviorSetting,
  canvasWheelZoomModifierSetting,
  detectedCanvasInputMode,
  inputModalityStateRef,
  setDetectedCanvasInputMode,
  canvasRef,
  trackpadGestureLockRef,
  viewportRef,
  reactFlow,
  onViewportChange,
}: UseWorkspaceCanvasInputModeParams): {
  resolvedCanvasInputMode: DetectedCanvasInputMode
  isTrackpadCanvasMode: boolean
  useManualCanvasWheelGestures: boolean
  handleCanvasWheelCapture: (event: WheelEvent) => void
} {
  const resolvedCanvasInputMode =
    canvasInputModeSetting === 'auto' ? detectedCanvasInputMode : canvasInputModeSetting
  const isTrackpadCanvasMode = resolvedCanvasInputMode === 'trackpad'
  const useManualCanvasWheelGestures =
    canvasInputModeSetting !== 'mouse' || canvasWheelBehaviorSetting === 'pan'

  const { handleCanvasWheelCapture } = useWorkspaceCanvasTrackpadGestures({
    canvasInputModeSetting,
    canvasWheelBehaviorSetting,
    canvasWheelZoomModifierSetting,
    resolvedCanvasInputMode,
    inputModalityStateRef,
    setDetectedCanvasInputMode,
    canvasRef,
    trackpadGestureLockRef,
    viewportRef,
    reactFlow,
    onViewportChange,
  })

  return {
    resolvedCanvasInputMode,
    isTrackpadCanvasMode,
    useManualCanvasWheelGestures,
    handleCanvasWheelCapture,
  }
}
