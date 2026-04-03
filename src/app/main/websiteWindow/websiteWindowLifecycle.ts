import type { BrowserWindow, WebContents } from 'electron'
import type { WebsiteWindowEventPayload, WebsiteWindowPolicy } from '../../../shared/contracts/dto'
import { matchesAnyHostPattern } from '../../../shared/utils/hostPatterns'
import type { WebsiteWindowRuntime } from './websiteWindowRuntime'
import { disposeWebsiteWindowDeviceMetrics } from './websiteWindowDeviceMetrics'
import { captureWebsiteWindowRuntimeSnapshot } from './websiteWindowRuntimeViewOps'

function cancelDiscardTimer(runtime: WebsiteWindowRuntime): void {
  if (!runtime.discardTimer) {
    return
  }

  clearTimeout(runtime.discardTimer)
  runtime.discardTimer = null
}

function disposeWebContents(runtime: WebsiteWindowRuntime, window: BrowserWindow): void {
  const hostView = runtime.hostView
  const view = runtime.view
  if (!view) {
    if (hostView && !window.isDestroyed()) {
      try {
        window.contentView.removeChildView(hostView)
      } catch {
        // ignore - window/view may already be gone during shutdown
      }
    }
    runtime.hostView = null
    return
  }

  if (!window.isDestroyed()) {
    try {
      if (hostView) {
        window.contentView.removeChildView(hostView)
      } else {
        window.contentView.removeChildView(view)
      }
    } catch {
      // ignore - window/view may already be gone during shutdown
    }
  }

  try {
    hostView?.setVisible(false)
    view.setVisible(false)
  } catch {
    // ignore - view may already be destroyed during shutdown
  }

  if (hostView) {
    try {
      hostView.removeChildView(view)
    } catch {
      // ignore - host/view may already be gone during shutdown
    }
  }

  try {
    disposeWebsiteWindowDeviceMetrics({ runtime, contents: view.webContents })
  } catch {
    runtime.deviceMetricsDebuggerAttached = false
    runtime.deviceMetricsScaleFactor = null
    runtime.deviceMetricsWidth = null
    runtime.deviceMetricsHeight = null
    runtime.deviceMetricsVersion += 1
  }

  try {
    runtime.disposeWebContentsListeners?.()
  } catch {
    // ignore - listeners might race with shutdown
  }
  runtime.disposeWebContentsListeners = null

  try {
    const contents = view.webContents
    if (!contents.isDestroyed()) {
      contents.close({ waitForBeforeUnload: false })
    }
  } catch {
    // ignore - webContents may already be destroyed during shutdown
  }

  runtime.scrollbarCssKey = null
  runtime.scrollbarCssSizePx = null
  runtime.scrollbarCssVersion += 1

  runtime.view = null
  runtime.hostView = null
}

function isKeepAliveHost(runtime: WebsiteWindowRuntime, policy: WebsiteWindowPolicy): boolean {
  if (!Array.isArray(policy.keepAliveHosts) || policy.keepAliveHosts.length === 0) {
    return false
  }

  const url = runtime.url ?? runtime.desiredUrl
  if (typeof url !== 'string' || url.trim().length === 0) {
    return false
  }

  return matchesAnyHostPattern({
    url,
    patterns: policy.keepAliveHosts,
  })
}

export function disposeWebsiteWindowRuntime(
  runtime: WebsiteWindowRuntime,
  window: BrowserWindow,
): void {
  cancelDiscardTimer(runtime)
  disposeWebContents(runtime, window)
}

export function transitionWebsiteWindowToCold({
  runtime,
  window,
  captureSnapshot,
  emit,
  emitState,
}: {
  runtime: WebsiteWindowRuntime
  window: BrowserWindow
  captureSnapshot: boolean
  emit: (payload: WebsiteWindowEventPayload) => void
  emitState: (runtime: WebsiteWindowRuntime) => void
}): void {
  if (runtime.lifecycle === 'cold') {
    return
  }

  cancelDiscardTimer(runtime)

  const hostView = runtime.hostView
  const view = runtime.view
  let contents: WebContents | null = null
  if (view) {
    try {
      contents = view.webContents
    } catch {
      contents = null
    }
  }
  if (hostView) {
    if (!window.isDestroyed()) {
      try {
        window.contentView.removeChildView(hostView)
      } catch {
        // ignore - window/view may already be gone during shutdown
      }
    }

    try {
      hostView.setVisible(false)
      view?.setVisible(false)
    } catch {
      // ignore - view may already be destroyed during shutdown
    }
  } else if (view) {
    if (!window.isDestroyed()) {
      try {
        window.contentView.removeChildView(view)
      } catch {
        // ignore - window/view may already be gone during shutdown
      }
    }

    try {
      view.setVisible(false)
    } catch {
      // ignore - view may already be destroyed during shutdown
    }
  }

  runtime.lifecycle = 'cold'
  runtime.canGoBack = false
  runtime.canGoForward = false
  runtime.isLoading = false
  runtime.title = null
  runtime.url = null

  if (contents && !contents.isDestroyed() && captureSnapshot) {
    void contents
      .capturePage()
      .then(image => {
        const jpeg = image.toJPEG(65)
        const dataUrl = `data:image/jpeg;base64,${jpeg.toString('base64')}`
        runtime.snapshotDataUrl = dataUrl
        emit({ type: 'snapshot', nodeId: runtime.nodeId, dataUrl })
      })
      .catch(() => undefined)
      .finally(() => {
        disposeWebContents(runtime, window)
      })
  } else {
    disposeWebContents(runtime, window)
  }

  emitState(runtime)
}

export function transitionWebsiteWindowToWarm({
  runtime,
  policy,
  window,
  emit,
  emitState,
}: {
  runtime: WebsiteWindowRuntime
  policy: WebsiteWindowPolicy
  window: BrowserWindow
  emit: (payload: WebsiteWindowEventPayload) => void
  emitState: (runtime: WebsiteWindowRuntime) => void
}): void {
  if (runtime.lifecycle !== 'active') {
    return
  }

  captureWebsiteWindowRuntimeSnapshot({
    runtime,
    quality: 60,
    emit,
  })

  runtime.lifecycle = 'warm'

  if (runtime.hostView) {
    if (!window.isDestroyed()) {
      try {
        window.contentView.removeChildView(runtime.hostView)
      } catch {
        // ignore - window/view may already be gone during shutdown
      }
    }

    try {
      runtime.hostView.setVisible(false)
    } catch {
      // ignore - view may already be destroyed during shutdown
    }
  }

  if (runtime.view) {
    try {
      runtime.view.setVisible(false)
    } catch {
      // ignore - view may already be destroyed during shutdown
    }
  }

  refreshWebsiteWindowDiscardTimer({
    runtime,
    policy,
    window,
    emit,
    emitState,
  })

  emitState(runtime)
}

export function refreshWebsiteWindowDiscardTimer({
  runtime,
  policy,
  window,
  emit,
  emitState,
}: {
  runtime: WebsiteWindowRuntime
  policy: WebsiteWindowPolicy
  window: BrowserWindow
  emit: (payload: WebsiteWindowEventPayload) => void
  emitState: (runtime: WebsiteWindowRuntime) => void
}): void {
  if (runtime.lifecycle !== 'warm') {
    cancelDiscardTimer(runtime)
    return
  }

  if (runtime.pinned || isKeepAliveHost(runtime, policy)) {
    cancelDiscardTimer(runtime)
    return
  }

  cancelDiscardTimer(runtime)
  const discardAfterMs = Math.max(0, policy.discardAfterMinutes) * 60_000
  runtime.discardTimer = setTimeout(() => {
    runtime.discardTimer = null
    if (runtime.lifecycle !== 'warm') {
      return
    }

    if (runtime.pinned || isKeepAliveHost(runtime, policy)) {
      return
    }

    transitionWebsiteWindowToCold({
      runtime,
      window,
      captureSnapshot: true,
      emit,
      emitState,
    })
  }, discardAfterMs)
}
