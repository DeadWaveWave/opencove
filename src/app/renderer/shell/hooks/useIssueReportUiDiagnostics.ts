import { useEffect } from 'react'
import {
  captureCanvasGeometryDetails,
  captureWindowGeometryDetails,
  recordUiGeometryBreadcrumb,
} from '@contexts/issueReport/presentation/renderer/uiGeometryDiagnostics'

export function useIssueReportUiDiagnostics(): void {
  useEffect(() => {
    let windowResizeCooldown: number | null = null
    const recordWindowResize = (): void => {
      if (windowResizeCooldown !== null) {
        return
      }
      recordUiGeometryBreadcrumb('window-resize', captureWindowGeometryDetails())
      windowResizeCooldown = window.setTimeout(() => {
        windowResizeCooldown = null
      }, 200)
    }

    recordUiGeometryBreadcrumb('window-geometry', captureWindowGeometryDetails())
    window.addEventListener('resize', recordWindowResize)
    let canvasResizeObserver: ResizeObserver | null = null
    let canvasResizeSettleTimer: number | null = null
    const connectCanvasObserver = (): boolean => {
      const canvas = document.querySelector('.workspace-canvas')
      if (!canvas) {
        return false
      }

      const recordCanvasGeometry = (): void => {
        recordUiGeometryBreadcrumb('canvas-geometry', captureCanvasGeometryDetails(canvas))
      }
      recordCanvasGeometry()
      if (typeof ResizeObserver !== 'undefined') {
        canvasResizeObserver = new ResizeObserver(() => {
          if (canvasResizeSettleTimer !== null) {
            window.clearTimeout(canvasResizeSettleTimer)
          }
          canvasResizeSettleTimer = window.setTimeout(() => {
            canvasResizeSettleTimer = null
            recordCanvasGeometry()
          }, 200)
        })
        canvasResizeObserver.observe(canvas)
      }
      return true
    }
    const canvasMountObserver = new MutationObserver(() => {
      if (connectCanvasObserver()) {
        canvasMountObserver.disconnect()
      }
    })
    if (!connectCanvasObserver()) {
      canvasMountObserver.observe(document.body, { childList: true, subtree: true })
    }
    return () => {
      window.removeEventListener('resize', recordWindowResize)
      if (windowResizeCooldown !== null) {
        window.clearTimeout(windowResizeCooldown)
      }
      if (canvasResizeSettleTimer !== null) {
        window.clearTimeout(canvasResizeSettleTimer)
      }
      canvasMountObserver.disconnect()
      canvasResizeObserver?.disconnect()
    }
  }, [])
}
