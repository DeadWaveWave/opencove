import { BrowserWindow } from 'electron'
import type { WebContents } from 'electron'
import type { WebsiteWindowEventPayload } from '../../../shared/contracts/dto'
import type { WebsiteWindowRuntime } from './websiteWindowRuntime'
import { syncWebsiteWindowDeviceMetrics } from './websiteWindowDeviceMetrics'
import { syncWebsiteWindowScrollbarStyle } from './websiteWindowScrollbarStyle'
import { resolveBrowserWindowScaleFactor } from './websiteWindowScaleFactor'
import { openExternalIfSafe } from './websiteWindowSecurity'
import { resolveWebsiteNavigationUrl } from './websiteWindowUrl'

function resolveWebsiteOwnerWindowScaleFactor(contents: WebContents): number {
  const ownerWindow = BrowserWindow.fromWebContents(contents)
  return resolveBrowserWindowScaleFactor(ownerWindow)
}

export function configureWebsiteWebContents({
  nodeId,
  contents,
  emit,
}: {
  nodeId: string
  contents: WebContents
  emit: (payload: WebsiteWindowEventPayload) => void
}): void {
  if (typeof contents.setVisualZoomLevelLimits === 'function') {
    void contents.setVisualZoomLevelLimits(1, 1).catch(() => undefined)
  }

  contents.setWindowOpenHandler(({ url }) => {
    const resolved = resolveWebsiteNavigationUrl(url)
    if (resolved.url) {
      emit({ type: 'open-url', sourceNodeId: nodeId, url: resolved.url })
      return { action: 'deny' }
    }

    openExternalIfSafe(url)
    return { action: 'deny' }
  })

  contents.on('will-navigate', (event, navigationUrl) => {
    const resolved = resolveWebsiteNavigationUrl(navigationUrl)
    if (resolved.url) {
      return
    }

    event.preventDefault()
    openExternalIfSafe(navigationUrl)
    emit({ type: 'error', nodeId, message: resolved.error ?? 'Blocked navigation' })
  })
}

export function registerWebsiteWebContentsRuntimeListeners({
  runtime,
  contents,
  emitState,
  emit,
}: {
  runtime: WebsiteWindowRuntime
  contents: WebContents
  emitState: (runtime: WebsiteWindowRuntime) => void
  emit: (payload: WebsiteWindowEventPayload) => void
}): () => void {
  const nodeId = runtime.nodeId

  const publishState = () => {
    runtime.canGoBack = contents.canGoBack()
    runtime.canGoForward = contents.canGoForward()
    runtime.url = contents.getURL() || null
    runtime.title = contents.getTitle() || null
    emitState(runtime)
  }

  const handleStartLoading = () => {
    runtime.isLoading = true
    publishState()
  }

  const handleStopLoading = () => {
    runtime.isLoading = false
    publishState()

    const resolvedViewportBounds =
      runtime.viewportBounds &&
      runtime.viewportBounds.width > 0 &&
      runtime.viewportBounds.height > 0
        ? runtime.viewportBounds
        : runtime.bounds
    if (resolvedViewportBounds) {
      syncWebsiteWindowDeviceMetrics({
        runtime,
        contents,
        canvasZoom: runtime.canvasZoom,
        windowScaleFactor: resolveWebsiteOwnerWindowScaleFactor(contents),
        viewportWidth: resolvedViewportBounds.width,
        viewportHeight: resolvedViewportBounds.height,
      })
    }

    syncWebsiteWindowScrollbarStyle({
      runtime,
      contents,
      canvasZoom: runtime.canvasZoom,
    })
  }

  const handleDidNavigate = (_event: Electron.Event, url: string) => {
    runtime.url = url
    publishState()
  }

  const handleDidNavigateInPage = (_event: Electron.Event, url: string) => {
    runtime.url = url
    publishState()
  }

  const handleTitleUpdated = (_event: Electron.Event, title: string) => {
    runtime.title = title
    publishState()
  }

  const handleFailLoad = (_event: Electron.Event, _errorCode: number, errorDescription: string) => {
    emit({ type: 'error', nodeId, message: errorDescription || 'Page load failed' })
    publishState()
  }

  const handleZoomChanged = () => {
    const expectedZoom = runtime.canvasZoom
    const currentZoom = contents.getZoomFactor()
    if (!Number.isFinite(currentZoom) || Math.abs(currentZoom - expectedZoom) > 0.001) {
      contents.setZoomFactor(expectedZoom)
    }
  }

  contents.on('did-start-loading', handleStartLoading)
  contents.on('did-stop-loading', handleStopLoading)
  contents.on('did-navigate', handleDidNavigate)
  contents.on('did-navigate-in-page', handleDidNavigateInPage)
  contents.on('page-title-updated', handleTitleUpdated)
  contents.on('did-fail-load', handleFailLoad)
  contents.on('zoom-changed', handleZoomChanged)

  publishState()

  return () => {
    contents.removeListener('did-start-loading', handleStartLoading)
    contents.removeListener('did-stop-loading', handleStopLoading)
    contents.removeListener('did-navigate', handleDidNavigate)
    contents.removeListener('did-navigate-in-page', handleDidNavigateInPage)
    contents.removeListener('page-title-updated', handleTitleUpdated)
    contents.removeListener('did-fail-load', handleFailLoad)
    contents.removeListener('zoom-changed', handleZoomChanged)
  }
}
