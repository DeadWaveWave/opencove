import type { BrowserWindow } from 'electron'
import type { WebsiteWindowEventPayload, WebsiteWindowPolicy } from '../../../shared/contracts/dto'
import { matchesAnyHostPattern } from '../../../shared/utils/hostPatterns'
import type { WebsiteWindowRuntime } from './websiteWindowRuntime'

function cancelDiscardTimer(runtime: WebsiteWindowRuntime): void {
  if (!runtime.discardTimer) {
    return
  }

  clearTimeout(runtime.discardTimer)
  runtime.discardTimer = null
}

function disposeWebContents(runtime: WebsiteWindowRuntime, window: BrowserWindow): void {
  const view = runtime.view
  if (!view) {
    return
  }

  window.contentView.removeChildView(view)
  view.setVisible(false)
  runtime.disposeWebContentsListeners?.()
  runtime.disposeWebContentsListeners = null

  const contents = view.webContents
  if (!contents.isDestroyed()) {
    contents.close({ waitForBeforeUnload: false })
  }

  runtime.view = null
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

  const view = runtime.view
  const contents = view?.webContents ?? null
  if (view) {
    window.contentView.removeChildView(view)
    view.setVisible(false)
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
