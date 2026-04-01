import type { WebContentsView } from 'electron'
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
  view: WebContentsView | null
  bounds: WebsiteWindowBounds | null
  lastActivatedAt: number
  canGoBack: boolean
  canGoForward: boolean
  isLoading: boolean
  title: string | null
  url: string | null
  snapshotDataUrl: string | null
  discardTimer: DiscardTimer | null
  disposeWebContentsListeners: (() => void) | null
}
