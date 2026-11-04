import type { WebsiteWindowBounds, WebsiteWindowEventPayload } from '../../../shared/contracts/dto'
import type { WebsiteWindowRuntime } from './websiteWindowRuntime'
import { resolveWebsiteWindowRuntimeWebContents } from './websiteWindowNavigationOps'
import { syncWebsiteWindowDeviceMetrics } from './websiteWindowDeviceMetrics'
import { syncWebsiteWindowScrollbarStyle } from './websiteWindowScrollbarStyle'
import { normalizeWebsiteCanvasZoom, resolveWebsiteViewBorderRadius } from './websiteWindowView'

export function normalizeWebsiteWindowSnapshotQuality(value: unknown): number {
  const resolved = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : 60

  return Math.min(95, Math.max(25, resolved))
}

function reportWebsiteSnapshotFailure(
  nodeId: string,
  stage: 'encode' | 'subscribe',
  error: unknown,
): void {
  const detail = error instanceof Error ? error.message : String(error)
  process.stderr.write(
    `[opencove-website-window] ${stage} failed: ${JSON.stringify({ nodeId, detail })}\n`,
  )
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
  const contents = resolveWebsiteWindowRuntimeWebContents(runtime)
  if (!contents) {
    return
  }

  void contents
    .capturePage(undefined, { stayHidden: true })
    .then(image => {
      const jpeg = image.toJPEG(quality)
      const dataUrl = `data:image/jpeg;base64,${jpeg.toString('base64')}`
      runtime.snapshotDataUrl = dataUrl
      emit({ type: 'snapshot', nodeId: runtime.nodeId, dataUrl })
    })
    .catch(() => undefined)
}

function hasCapturableWebsiteWindowBounds(runtime: WebsiteWindowRuntime): boolean {
  const bounds = runtime.viewportBounds ?? runtime.bounds
  return Boolean(bounds && bounds.width > 0 && bounds.height > 0)
}

function isWebsiteWindowDocumentReadyForSnapshot(runtime: WebsiteWindowRuntime): boolean {
  return (
    runtime.lifecycle === 'active' &&
    runtime.isLoading === false &&
    runtime.snapshotDocumentReady &&
    typeof runtime.url === 'string' &&
    runtime.url.trim().length > 0
  )
}

export function flushPendingWebsiteWindowRuntimeSnapshot({
  runtime,
  emit,
}: {
  runtime: WebsiteWindowRuntime
  emit: (payload: WebsiteWindowEventPayload) => void
}): boolean {
  const pendingQuality = runtime.pendingSnapshotQuality
  if (pendingQuality === null || runtime.snapshotCaptureInFlight) {
    return false
  }

  if (
    !isWebsiteWindowDocumentReadyForSnapshot(runtime) ||
    !hasCapturableWebsiteWindowBounds(runtime)
  ) {
    return false
  }

  const contents = resolveWebsiteWindowRuntimeWebContents(runtime)
  if (!contents) {
    return false
  }

  runtime.snapshotCaptureInFlight = true
  let disposed = false
  const dispose = () => {
    if (disposed) {
      return
    }
    disposed = true
    contents.removeListener('destroyed', dispose)
    try {
      if (!contents.isDestroyed()) {
        contents.endFrameSubscription()
      }
    } catch {
      // The view may be destroyed while a presentation is queued.
    }
    if (runtime.disposeSnapshotCapture === dispose) {
      runtime.disposeSnapshotCapture = null
      runtime.snapshotCaptureInFlight = false
    }
  }
  runtime.disposeSnapshotCapture = dispose
  contents.once('destroyed', dispose)

  try {
    // capturePage can reject before the first compositor surface is available on macOS.
    // Electron starts a video capturer here; Chromium's Start requests a refresh of the
    // existing surface, so an idle page needs no new paint (or explicit invalidate).
    // See FrameSinkVideoCapturerImpl::Start in Chromium 146.0.7680.216.
    // Consume one valid image, then release the subscription without retrying.
    contents.beginFrameSubscription(false, image => {
      if (disposed) {
        return
      }
      if (
        resolveWebsiteWindowRuntimeWebContents(runtime) !== contents ||
        !isWebsiteWindowDocumentReadyForSnapshot(runtime) ||
        runtime.pendingSnapshotQuality === null
      ) {
        dispose()
        return
      }
      // A zoom freeze hides the native view immediately after requesting a snapshot.
      // Its already-presented frame is still valid even if canvas bounds are now empty.
      if (image.isEmpty()) {
        return
      }

      try {
        const jpeg = image.toJPEG(runtime.pendingSnapshotQuality)
        if (jpeg.length === 0) {
          return
        }
        const dataUrl = `data:image/jpeg;base64,${jpeg.toString('base64')}`
        runtime.snapshotDataUrl = dataUrl
        runtime.pendingSnapshotQuality = null
        dispose()
        emit({ type: 'snapshot', nodeId: runtime.nodeId, dataUrl })
      } catch (error) {
        dispose()
        reportWebsiteSnapshotFailure(runtime.nodeId, 'encode', error)
      }
    })
  } catch (error) {
    dispose()
    reportWebsiteSnapshotFailure(runtime.nodeId, 'subscribe', error)
  }

  return true
}

export function requestWebsiteWindowRuntimeSnapshot({
  runtime,
  quality,
  emit,
}: {
  runtime: WebsiteWindowRuntime
  quality: number
  emit: (payload: WebsiteWindowEventPayload) => void
}): void {
  runtime.pendingSnapshotQuality = quality
  flushPendingWebsiteWindowRuntimeSnapshot({ runtime, emit })
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
