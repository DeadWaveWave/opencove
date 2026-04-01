import type { WebContents } from 'electron'
import type { WebsiteWindowEventPayload } from '../../../shared/contracts/dto'
import type { WebsiteWindowRuntime } from './websiteWindowRuntime'
import { openExternalIfSafe } from './websiteWindowSecurity'
import { resolveWebsiteNavigationUrl } from './websiteWindowUrl'

export function configureWebsiteWebContents({
  nodeId,
  contents,
  emit,
}: {
  nodeId: string
  contents: WebContents
  emit: (payload: WebsiteWindowEventPayload) => void
}): void {
  contents.setWindowOpenHandler(({ url }) => {
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

  contents.on('did-start-loading', handleStartLoading)
  contents.on('did-stop-loading', handleStopLoading)
  contents.on('did-navigate', handleDidNavigate)
  contents.on('did-navigate-in-page', handleDidNavigateInPage)
  contents.on('page-title-updated', handleTitleUpdated)
  contents.on('did-fail-load', handleFailLoad)

  publishState()

  return () => {
    contents.removeListener('did-start-loading', handleStartLoading)
    contents.removeListener('did-stop-loading', handleStopLoading)
    contents.removeListener('did-navigate', handleDidNavigate)
    contents.removeListener('did-navigate-in-page', handleDidNavigateInPage)
    contents.removeListener('page-title-updated', handleTitleUpdated)
    contents.removeListener('did-fail-load', handleFailLoad)
  }
}
