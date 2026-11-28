import { useEffect, useRef } from 'react'
import type { Node, ReactFlowInstance, Viewport } from '@xyflow/react'
import type { TerminalNodeData } from '../../../types'

/**
 * The settings slider for the focus-target zoom previews the zoom on the live canvas and puts the
 * camera back at release. React Flow owns the camera, so the preview zooms it directly and writes
 * no copy; the camera from before the preview is this hook's own memory, taken when the preview
 * starts and spent when it ends (#647 S8).
 */
export function useFocusTargetZoomPreview({
  reactFlow,
  focusNodeTargetZoom,
  isPreviewing,
}: {
  reactFlow: ReactFlowInstance<Node<TerminalNodeData>>
  focusNodeTargetZoom: number
  isPreviewing: boolean
}): void {
  const cameraBeforePreviewRef = useRef<Viewport | null>(null)

  useEffect(() => {
    if (!isPreviewing) {
      const cameraBeforePreview = cameraBeforePreviewRef.current
      if (!cameraBeforePreview) {
        return
      }

      cameraBeforePreviewRef.current = null
      void reactFlow.setViewport(cameraBeforePreview, { duration: 0 })
      return
    }

    if (!cameraBeforePreviewRef.current) {
      cameraBeforePreviewRef.current = reactFlow.getViewport()
    }

    void reactFlow.zoomTo(focusNodeTargetZoom, { duration: 0 })
  }, [focusNodeTargetZoom, isPreviewing, reactFlow])
}
