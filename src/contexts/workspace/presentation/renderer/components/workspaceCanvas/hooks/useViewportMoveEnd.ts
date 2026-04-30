import { useCallback } from 'react'
import type { Viewport } from '@xyflow/react'

export function useWorkspaceCanvasViewportMoveEnd({
  viewportRef,
  onViewportChange,
}: {
  viewportRef: React.MutableRefObject<Viewport>
  onViewportChange: (viewport: Viewport) => void
}): (_event: MouseEvent | TouchEvent | null, nextViewport: Viewport) => void {
  return useCallback(
    (_event: MouseEvent | TouchEvent | null, nextViewport: Viewport) => {
      const normalizedViewport = {
        x: nextViewport.x,
        y: nextViewport.y,
        zoom: nextViewport.zoom,
      }

      viewportRef.current = normalizedViewport
      onViewportChange(normalizedViewport)
    },
    [onViewportChange, viewportRef],
  )
}
