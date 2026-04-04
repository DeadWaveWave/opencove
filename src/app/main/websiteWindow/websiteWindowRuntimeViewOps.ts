import type { WebsiteWindowBounds, WebsiteWindowEventPayload } from '../../../shared/contracts/dto'
import type { WebsiteWindowRuntime } from './websiteWindowRuntime'
import { syncWebsiteWindowDeviceMetrics } from './websiteWindowDeviceMetrics'
import { syncWebsiteWindowScrollbarStyle } from './websiteWindowScrollbarStyle'
import { normalizeWebsiteCanvasZoom, resolveWebsiteViewBorderRadius } from './websiteWindowView'

export function normalizeWebsiteWindowSnapshotQuality(value: unknown): number {
  const resolved = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : 60

  return Math.min(95, Math.max(25, resolved))
}

export function captureWebsiteWindowRuntimeSnapshot({
  runtime,
  quality,
  emit,
}: {
  runtime: WebsiteWindowRuntime
  quality: number
  emit: (payload: WebsiteWindowEventPayload) => void
}): void {
  const view = runtime.view
  if (!view) {
    return
  }

  let contents: (typeof view)['webContents'] | null = null
  try {
    contents = view.webContents
  } catch {
    return
  }

  if (!contents || contents.isDestroyed()) {
    return
  }

  void contents
    .capturePage()
    .then(image => {
      const jpeg = image.toJPEG(quality)
      const dataUrl = `data:image/jpeg;base64,${jpeg.toString('base64')}`
      runtime.snapshotDataUrl = dataUrl
      emit({ type: 'snapshot', nodeId: runtime.nodeId, dataUrl })
    })
    .catch(() => undefined)
}

export function applyWebsiteWindowBounds(
  runtime: WebsiteWindowRuntime,
  bounds: WebsiteWindowBounds,
): void {
  const hostView = runtime.hostView
  if (!hostView) {
    return
  }

  try {
    if (bounds.width <= 0 || bounds.height <= 0) {
      hostView.setVisible(false)
      if (runtime.view) {
        runtime.view.setVisible(false)
      }
      return
    }

    hostView.setVisible(true)
    hostView.setBounds(bounds)
  } catch {
    // ignore - view may already be destroyed during shutdown
  }
}

export function applyWebsiteWindowViewportMetrics({
  runtime,
  bounds,
  viewportBounds,
  canvasZoom,
  windowScaleFactor,
}: {
  runtime: WebsiteWindowRuntime
  bounds: WebsiteWindowBounds
  viewportBounds: WebsiteWindowBounds | null
  canvasZoom: unknown
  windowScaleFactor: number
}): void {
  const hostView = runtime.hostView
  const view = runtime.view
  if (!hostView || !view) {
    return
  }

  if (bounds.width <= 0 || bounds.height <= 0) {
    applyWebsiteWindowBounds(runtime, bounds)
    return
  }

  const normalizedCanvasZoom = normalizeWebsiteCanvasZoom(canvasZoom)
  const resolvedViewportBounds =
    viewportBounds && viewportBounds.width > 0 && viewportBounds.height > 0
      ? viewportBounds
      : bounds

  try {
    const contents = view.webContents
    if (!contents.isDestroyed()) {
      const currentZoom = contents.getZoomFactor()
      if (!Number.isFinite(currentZoom) || Math.abs(currentZoom - normalizedCanvasZoom) > 0.001) {
        contents.setZoomFactor(normalizedCanvasZoom)
      }

      syncWebsiteWindowDeviceMetrics({
        runtime,
        contents,
        canvasZoom: normalizedCanvasZoom,
        windowScaleFactor,
        viewportWidth: resolvedViewportBounds.width,
        viewportHeight: resolvedViewportBounds.height,
      })

      syncWebsiteWindowScrollbarStyle({
        runtime,
        contents,
        canvasZoom: normalizedCanvasZoom,
      })
    }

    // Ensure the view is clipped to the hostView bounds when viewportBounds is offset
    // (e.g. when the node is partially outside the workspace viewport). Without an
    // explicit clip, child views can paint outside the host bounds and cover app chrome.
    if (typeof hostView.setBorderRadius === 'function') {
      hostView.setBorderRadius(1)
    }

    view.setBorderRadius(resolveWebsiteViewBorderRadius(normalizedCanvasZoom))

    view.setBounds({
      x: resolvedViewportBounds.x - bounds.x,
      y: resolvedViewportBounds.y - bounds.y,
      width: resolvedViewportBounds.width,
      height: resolvedViewportBounds.height,
    })
    view.setVisible(true)
  } catch {
    // ignore - view may already be destroyed during shutdown
  }
  applyWebsiteWindowBounds(runtime, bounds)
}
