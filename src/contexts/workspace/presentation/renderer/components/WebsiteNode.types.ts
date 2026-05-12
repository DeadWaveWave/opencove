import type { BrowserMode, WebsiteWindowSessionMode } from '@shared/contracts/dto'
import type { BrowserSearchEngineId } from '@contexts/settings/domain/browserSettings'
import type { LabelColor } from '@shared/types/labelColor'
import type { NodeFrame, Point } from '../types'

export interface WebsiteNodeInteractionOptions {
  normalizeViewport?: boolean
  selectNode?: boolean
  shiftKey?: boolean
}

export interface WebsiteNodeProps {
  nodeId: string
  title: string
  url: string
  pinned: boolean
  sessionMode: WebsiteWindowSessionMode
  profileId: string | null
  browserMode: BrowserMode
  browserDefaultMode: BrowserMode
  browserSearchEngine: BrowserSearchEngineId
  isFullscreen: boolean
  previousFrame: NodeFrame | null
  labelColor: LabelColor | null
  position: Point
  width: number
  height: number
  onClose: () => void
  onResize: (frame: NodeFrame) => void
  onInteractionStart?: (options?: WebsiteNodeInteractionOptions) => void
  onUrlCommit: (nextUrl: string) => void
  onPinnedChange: (nextPinned: boolean) => void
  onSessionChange: (sessionMode: WebsiteWindowSessionMode, profileId: string | null) => void
  onModeChange: (browserMode: BrowserMode) => void
  onFullscreenChange: (
    frame: NodeFrame,
    previousFrame: NodeFrame | null,
    isFullscreen: boolean,
  ) => void
}
