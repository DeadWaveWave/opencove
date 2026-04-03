import type { WebsiteWindowSessionMode } from '../../../shared/contracts/dto'
import type { WebsiteWindowRuntime } from './websiteWindowRuntime'

export function ensureWebsiteWindowRuntime({
  runtimeByNodeId,
  nodeId,
  desiredUrl,
  pinned,
  sessionMode,
  profileId,
}: {
  runtimeByNodeId: Map<string, WebsiteWindowRuntime>
  nodeId: string
  desiredUrl: string
  pinned: boolean
  sessionMode: WebsiteWindowSessionMode
  profileId: string | null
}): WebsiteWindowRuntime {
  const existing = runtimeByNodeId.get(nodeId)
  if (existing) {
    existing.desiredUrl = desiredUrl
    existing.pinned = pinned
    existing.sessionMode = sessionMode
    existing.profileId = profileId
    return existing
  }

  const runtime: WebsiteWindowRuntime = {
    nodeId,
    lifecycle: 'cold',
    pinned,
    sessionMode,
    profileId,
    desiredUrl,
    hostView: null,
    view: null,
    bounds: null,
    viewportBounds: null,
    canvasZoom: 1,
    lastActivatedAt: 0,
    canGoBack: false,
    canGoForward: false,
    isLoading: false,
    title: null,
    url: null,
    snapshotDataUrl: null,
    scrollbarCssKey: null,
    scrollbarCssSizePx: null,
    scrollbarCssVersion: 0,
    deviceMetricsDebuggerAttached: false,
    deviceMetricsScaleFactor: null,
    deviceMetricsWidth: null,
    deviceMetricsHeight: null,
    deviceMetricsVersion: 0,
    discardTimer: null,
    disposeWebContentsListeners: null,
  }

  runtimeByNodeId.set(nodeId, runtime)
  return runtime
}
