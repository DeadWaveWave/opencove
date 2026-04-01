import type { WebsiteWindowBounds, WebsiteWindowEventPayload } from '../../../shared/contracts/dto'
import type { WebsiteWindowRuntime } from './websiteWindowRuntime'
import { normalizeWebsiteCanvasZoom, resolveWebsiteViewBorderRadius } from './websiteWindowView'

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
  const view = runtime.view
  if (!view) {
    return
  }

  try {
    if (bounds.width <= 0 || bounds.height <= 0) {
      view.setVisible(false)
      return
    }

    view.setVisible(true)
    view.setBounds(bounds)
  } catch {
    // ignore - view may already be destroyed during shutdown
  }
}

export function applyWebsiteWindowViewportMetrics({
  runtime,
  bounds,
  canvasZoom,
}: {
  runtime: WebsiteWindowRuntime
  bounds: WebsiteWindowBounds
  canvasZoom: unknown
}): void {
  const view = runtime.view
  if (!view) {
    return
  }

  if (bounds.width <= 0 || bounds.height <= 0) {
    applyWebsiteWindowBounds(runtime, bounds)
    return
  }

  const normalizedCanvasZoom = normalizeWebsiteCanvasZoom(canvasZoom)

  try {
    const contents = view.webContents
    if (!contents.isDestroyed()) {
      const currentZoom = contents.getZoomFactor()
      if (!Number.isFinite(currentZoom) || Math.abs(currentZoom - normalizedCanvasZoom) > 0.001) {
        contents.setZoomFactor(normalizedCanvasZoom)
      }
    }

    view.setBorderRadius(resolveWebsiteViewBorderRadius(normalizedCanvasZoom))
  } catch {
    // ignore - view may already be destroyed during shutdown
  }
  applyWebsiteWindowBounds(runtime, bounds)
}
