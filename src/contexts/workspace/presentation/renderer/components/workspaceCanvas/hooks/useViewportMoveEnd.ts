import { useCallback } from 'react'
import type { Viewport } from '@xyflow/react'

export function useWorkspaceCanvasViewportMoveEnd({
  viewportRef,
  onViewportChange,
  onUserViewportMoveEnd,
}: {
  viewportRef: React.MutableRefObject<Viewport>
  onViewportChange: (viewport: Viewport) => void
  onUserViewportMoveEnd?: () => void
}): (_event: MouseEvent | TouchEvent | null, nextViewport: Viewport) => void {
  return useCallback(
    (event: MouseEvent | TouchEvent | null, nextViewport: Viewport) => {
      const normalizedViewport = {
        x: nextViewport.x,
        y: nextViewport.y,
        zoom: nextViewport.zoom,
      }

      viewportRef.current = normalizedViewport
      onViewportChange(normalizedViewport)

      if (event) {
        onUserViewportMoveEnd?.()
      }
    },
    [onUserViewportMoveEnd, onViewportChange, viewportRef],
  )
}
