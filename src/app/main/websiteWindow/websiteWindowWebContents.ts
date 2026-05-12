import { BrowserWindow } from 'electron'
import type { WebContents } from 'electron'
import type { WebsiteWindowEventPayload } from '../../../shared/contracts/dto'
import type { WebsiteWindowRuntime } from './websiteWindowRuntime'
import { syncWebsiteWindowDeviceMetrics } from './websiteWindowDeviceMetrics'
import { syncWebsiteWindowScrollbarStyle } from './websiteWindowScrollbarStyle'
import { resolveBrowserWindowScaleFactor } from './websiteWindowScaleFactor'
import { openExternalIfSafe } from './websiteWindowSecurity'
import { resolveWebsiteNavigationUrl } from './websiteWindowUrl'

let nextFindRequestId = 1

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
  flushPendingSnapshot,
  recordHistoryVisit,
}: {
  runtime: WebsiteWindowRuntime
  contents: WebContents
  emitState: (runtime: WebsiteWindowRuntime) => void
  emit: (payload: WebsiteWindowEventPayload) => void
  flushPendingSnapshot: (runtime: WebsiteWindowRuntime) => void
  recordHistoryVisit?: (runtime: WebsiteWindowRuntime) => void
}): () => void {
  const nodeId = runtime.nodeId

  const publishState = () => {
    const history = contents.navigationHistory
    runtime.canGoBack =
      history && typeof history.canGoBack === 'function'
        ? history.canGoBack()
        : contents.canGoBack()
    runtime.canGoForward =
      history && typeof history.canGoForward === 'function'
        ? history.canGoForward()
        : contents.canGoForward()
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

    flushPendingSnapshot(runtime)
  }

  const handleDidNavigate = (_event: Electron.Event, url: string) => {
    runtime.url = url
    publishState()
    recordHistoryVisit?.(runtime)
  }

  const handleDidNavigateInPage = (_event: Electron.Event, url: string) => {
    runtime.url = url
    publishState()
    recordHistoryVisit?.(runtime)
  }

  const handleTitleUpdated = (_event: Electron.Event, title: string) => {
    runtime.title = title
    publishState()
  }

  const handleFaviconUpdated = (_event: Electron.Event, favicons: string[]) => {
    runtime.faviconUrl = favicons.find(item => typeof item === 'string' && item.length > 0) ?? null
    publishState()
  }

  const handleFoundInPage = (_event: Electron.Event, result: Electron.Result) => {
    emit({
      type: 'find-result',
      nodeId,
      requestId: result.requestId,
      activeMatchOrdinal: result.activeMatchOrdinal,
      matches: result.matches,
      finalUpdate: result.finalUpdate,
    })
  }

  const handleBeforeInputEvent = (event: Electron.Event, input: Electron.Input) => {
    const isFindShortcut =
      (input.control || input.meta) &&
      !input.alt &&
      typeof input.key === 'string' &&
      input.key.toLowerCase() === 'f'
    if (!isFindShortcut) {
      return
    }

    event.preventDefault()
    emit({
      type: 'find-request',
      nodeId,
      requestId: nextFindRequestId++,
    })
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
  contents.on('page-favicon-updated', handleFaviconUpdated)
  contents.on('found-in-page', handleFoundInPage)
  contents.on('before-input-event', handleBeforeInputEvent)
  contents.on('did-fail-load', handleFailLoad)
  contents.on('zoom-changed', handleZoomChanged)

  publishState()

  return () => {
    contents.removeListener('did-start-loading', handleStartLoading)
    contents.removeListener('did-stop-loading', handleStopLoading)
    contents.removeListener('did-navigate', handleDidNavigate)
    contents.removeListener('did-navigate-in-page', handleDidNavigateInPage)
    contents.removeListener('page-title-updated', handleTitleUpdated)
    contents.removeListener('page-favicon-updated', handleFaviconUpdated)
    contents.removeListener('found-in-page', handleFoundInPage)
    contents.removeListener('before-input-event', handleBeforeInputEvent)
    contents.removeListener('did-fail-load', handleFailLoad)
    contents.removeListener('zoom-changed', handleZoomChanged)
  }
}
