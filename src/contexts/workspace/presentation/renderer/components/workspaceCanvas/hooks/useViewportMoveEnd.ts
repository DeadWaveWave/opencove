import { useCallback } from 'react'
import type { Viewport } from '@xyflow/react'

// Still the commit path until the commit point of S8 PR 2 replaces it. React Flow's store holds the
// camera; this only hands the move end's camera to the shell.
export function useWorkspaceCanvasViewportMoveEnd({
  onViewportChange,
}: {
  onViewportChange: (viewport: Viewport) => void
}): (_event: MouseEvent | TouchEvent | null, nextViewport: Viewport) => void {
  return useCallback(
    (_event: MouseEvent | TouchEvent | null, nextViewport: Viewport) => {
      onViewportChange({
        x: nextViewport.x,
        y: nextViewport.y,
        zoom: nextViewport.zoom,
      })
    },
    [onViewportChange],
  )
}
