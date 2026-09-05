import { useStore } from '@xyflow/react'
import {
  selectDragSurfaceSelectionMode,
  selectViewportInteractionActive,
  selectViewportZoom,
} from './reactFlowState'
import { useViewportInteractionSettledState } from './useViewportInteractionSettledState'

export function useTerminalViewportState() {
  const isDragSurfaceSelectionMode = useStore(selectDragSurfaceSelectionMode)
  const isViewportInteractionActive = useStore(selectViewportInteractionActive)
  const isViewportInteractionSettledActive = useViewportInteractionSettledState(
    isViewportInteractionActive,
  )
  const viewportZoom = useStore(selectViewportZoom)
  return {
    isDragSurfaceSelectionMode,
    isViewportInteractionActive,
    isViewportInteractionSettledActive,
    viewportZoom,
  }
}
