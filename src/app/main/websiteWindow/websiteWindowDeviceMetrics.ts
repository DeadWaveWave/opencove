import type { WebContents } from 'electron'
import type { WebsiteWindowRuntime } from './websiteWindowRuntime'

const WEBSITE_DEVICE_METRICS_MIN_SCALE_FACTOR = 0.25
const WEBSITE_DEVICE_METRICS_MAX_SCALE_FACTOR = 12

function normalizeWindowScaleFactor(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return 1
  }

  return Math.max(0.5, Math.min(4, value))
}

function normalizeViewportDimension(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return 1
  }

  return Math.max(1, Math.round(value))
}

function resolveWebsiteDeviceScaleFactor({
  windowScaleFactor,
  canvasZoom,
}: {
  windowScaleFactor: number
  canvasZoom: number
}): number {
  if (!Number.isFinite(canvasZoom) || canvasZoom <= 0) {
    return windowScaleFactor
  }

  const resolved = windowScaleFactor / canvasZoom
  return Math.min(
    WEBSITE_DEVICE_METRICS_MAX_SCALE_FACTOR,
    Math.max(WEBSITE_DEVICE_METRICS_MIN_SCALE_FACTOR, resolved),
  )
}

export function syncWebsiteWindowDeviceMetrics({
  runtime,
  contents,
  canvasZoom,
  windowScaleFactor,
  viewportWidth,
  viewportHeight,
}: {
  runtime: WebsiteWindowRuntime
  contents: WebContents
  canvasZoom: number
  windowScaleFactor: number
  viewportWidth: number
  viewportHeight: number
}): void {
  if (contents.isDestroyed()) {
    return
  }

  let currentUrl = ''
  try {
    currentUrl = contents.getURL()
  } catch {
    currentUrl = ''
  }
  if (!currentUrl || currentUrl === 'about:blank') {
    return
  }

  const normalizedWindowScaleFactor = normalizeWindowScaleFactor(windowScaleFactor)
  const resolvedDeviceScaleFactor = resolveWebsiteDeviceScaleFactor({
    windowScaleFactor: normalizedWindowScaleFactor,
    canvasZoom,
  })
  const resolvedWidth = normalizeViewportDimension(viewportWidth)
  const resolvedHeight = normalizeViewportDimension(viewportHeight)

  if (
    runtime.deviceMetricsScaleFactor === resolvedDeviceScaleFactor &&
    runtime.deviceMetricsWidth === resolvedWidth &&
    runtime.deviceMetricsHeight === resolvedHeight
  ) {
    return
  }

  runtime.deviceMetricsScaleFactor = resolvedDeviceScaleFactor
  runtime.deviceMetricsWidth = resolvedWidth
  runtime.deviceMetricsHeight = resolvedHeight
  runtime.deviceMetricsVersion += 1
  const version = runtime.deviceMetricsVersion

  void (async () => {
    if (contents.isDestroyed()) {
      return
    }

    const debuggerApi = contents.debugger
    if (!debuggerApi) {
      return
    }

    if (!debuggerApi.isAttached()) {
      try {
        debuggerApi.attach('1.3')
        runtime.deviceMetricsDebuggerAttached = true
      } catch {
        return
      }
    }

    try {
      await debuggerApi.sendCommand('Emulation.setDeviceMetricsOverride', {
        mobile: false,
        width: resolvedWidth,
        height: resolvedHeight,
        deviceScaleFactor: resolvedDeviceScaleFactor,
        scale: 1,
      })
    } catch {
      return
    }

    if (contents.isDestroyed()) {
      return
    }

    if (runtime.deviceMetricsVersion !== version) {
      return
    }
  })()
}

export function disposeWebsiteWindowDeviceMetrics({
  runtime,
  contents,
}: {
  runtime: WebsiteWindowRuntime
  contents: WebContents
}): void {
  runtime.deviceMetricsScaleFactor = null
  runtime.deviceMetricsWidth = null
  runtime.deviceMetricsHeight = null
  runtime.deviceMetricsVersion += 1

  if (!runtime.deviceMetricsDebuggerAttached) {
    return
  }

  runtime.deviceMetricsDebuggerAttached = false
  try {
    const debuggerApi = contents.debugger
    if (debuggerApi?.isAttached()) {
      debuggerApi.detach()
    }
  } catch {
    // ignore
  }
}
