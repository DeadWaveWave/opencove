import type { FindWebsiteWindowInput } from '../../../shared/contracts/dto'
import type { WebsiteWindowRuntime } from './websiteWindowRuntime'
import { resolveWebsiteWindowRuntimeWebContents } from './websiteWindowNavigationOps'

export function goBackWebsiteWindowNode(
  runtimeByNodeId: Map<string, WebsiteWindowRuntime>,
  nodeId: string,
): void {
  const runtime = runtimeByNodeId.get(nodeId) ?? null
  const contents = runtime ? resolveWebsiteWindowRuntimeWebContents(runtime) : null
  if (!runtime || !contents) {
    return
  }

  const history = contents.navigationHistory
  if (history && typeof history.canGoBack === 'function' && history.canGoBack()) {
    history.goBack()
    return
  }

  if (contents.canGoBack()) {
    contents.goBack()
  }
}

export function goForwardWebsiteWindowNode(
  runtimeByNodeId: Map<string, WebsiteWindowRuntime>,
  nodeId: string,
): void {
  const runtime = runtimeByNodeId.get(nodeId) ?? null
  const contents = runtime ? resolveWebsiteWindowRuntimeWebContents(runtime) : null
  if (!runtime || !contents) {
    return
  }

  const history = contents.navigationHistory
  if (history && typeof history.canGoForward === 'function' && history.canGoForward()) {
    history.goForward()
    return
  }

  if (contents.canGoForward()) {
    contents.goForward()
  }
}

export function reloadWebsiteWindowNode(
  runtimeByNodeId: Map<string, WebsiteWindowRuntime>,
  nodeId: string,
): void {
  const runtime = runtimeByNodeId.get(nodeId) ?? null
  const contents = runtime ? resolveWebsiteWindowRuntimeWebContents(runtime) : null
  if (runtime && contents) {
    contents.reload()
  }
}

export function stopWebsiteWindowNode(
  runtimeByNodeId: Map<string, WebsiteWindowRuntime>,
  nodeId: string,
): void {
  const runtime = runtimeByNodeId.get(nodeId) ?? null
  const contents = runtime ? resolveWebsiteWindowRuntimeWebContents(runtime) : null
  if (runtime && contents) {
    contents.stop()
  }
}

export function findInWebsiteWindowNode(
  runtimeByNodeId: Map<string, WebsiteWindowRuntime>,
  payload: FindWebsiteWindowInput,
): void {
  const runtime = runtimeByNodeId.get(payload.nodeId.trim()) ?? null
  const contents = runtime ? resolveWebsiteWindowRuntimeWebContents(runtime) : null
  const query = typeof payload.query === 'string' ? payload.query.trim() : ''
  if (!runtime || !contents || query.length === 0) {
    return
  }

  contents.findInPage(query, {
    forward: payload.forward !== false,
    findNext: payload.findNext === true,
  })
}

export function stopFindInWebsiteWindowNode(
  runtimeByNodeId: Map<string, WebsiteWindowRuntime>,
  nodeId: string,
): void {
  const runtime = runtimeByNodeId.get(nodeId) ?? null
  const contents = runtime ? resolveWebsiteWindowRuntimeWebContents(runtime) : null
  if (runtime && contents) {
    contents.stopFindInPage('clearSelection')
  }
}
