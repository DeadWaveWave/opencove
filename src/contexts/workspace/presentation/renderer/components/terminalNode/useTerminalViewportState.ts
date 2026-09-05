import { useStore } from '@xyflow/react'
import { selectDragSurfaceSelectionMode, selectViewportInteractionActive } from './reactFlowState'
import { useViewportInteractionSettledState } from './useViewportInteractionSettledState'

export function useTerminalViewportState() {
  const isDragSurfaceSelectionMode = useStore(selectDragSurfaceSelectionMode)
  const isViewportInteractionActive = useStore(selectViewportInteractionActive)
  const isViewportInteractionSettledActive = useViewportInteractionSettledState(
    isViewportInteractionActive,
  )
  const viewportZoom = useStore(storeState => {
    const state = storeState as unknown as { transform?: [number, number, number] }
    const zoom = state.transform?.[2] ?? 1
    return Number.isFinite(zoom) && zoom > 0 ? zoom : 1
  })
  return {
    isDragSurfaceSelectionMode,
    isViewportInteractionActive,
    isViewportInteractionSettledActive,
    viewportZoom,
  }
}
