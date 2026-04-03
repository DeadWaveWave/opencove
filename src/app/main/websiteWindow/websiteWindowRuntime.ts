import type { View, WebContentsView } from 'electron'
import type {
  WebsiteWindowBounds,
  WebsiteWindowLifecycle,
  WebsiteWindowSessionMode,
} from '../../../shared/contracts/dto'

type DiscardTimer = ReturnType<typeof setTimeout>

export interface WebsiteWindowRuntime {
  nodeId: string
  lifecycle: WebsiteWindowLifecycle
  pinned: boolean
  sessionMode: WebsiteWindowSessionMode
  profileId: string | null
  desiredUrl: string
  hostView: View | null
  view: WebContentsView | null
  bounds: WebsiteWindowBounds | null
  viewportBounds: WebsiteWindowBounds | null
  canvasZoom: number
  lastActivatedAt: number
  canGoBack: boolean
  canGoForward: boolean
  isLoading: boolean
  title: string | null
  url: string | null
  snapshotDataUrl: string | null
  scrollbarCssKey: string | null
  scrollbarCssSizePx: number | null
  scrollbarCssVersion: number
  deviceMetricsDebuggerAttached: boolean
  deviceMetricsScaleFactor: number | null
  deviceMetricsWidth: number | null
  deviceMetricsHeight: number | null
  deviceMetricsVersion: number
  discardTimer: DiscardTimer | null
  disposeWebContentsListeners: (() => void) | null
}
