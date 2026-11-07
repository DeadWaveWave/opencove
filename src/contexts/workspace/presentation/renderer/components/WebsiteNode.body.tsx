import type { JSX, RefObject } from 'react'
import { useTranslation } from '@app/renderer/i18n'
import type {
  BrowserMode,
  WebsiteWindowLifecycle,
  WebsiteWindowSessionMode,
} from '@shared/contracts/dto'
import type { BrowserSearchEngineId } from '@contexts/settings/domain/browserSettings'
import { useWebsiteWindowStore } from '../store/useWebsiteWindowStore'
import { useWebsiteInitialSnapshot } from './WebsiteNode.snapshot'
import { WebsiteNodeHomePage } from './WebsiteNode.homePage'
import { WebsiteNodeIframe } from './WebsiteNode.iframe'
import { WebsiteNodeNativePlaceholder } from './WebsiteNode.nativePlaceholder'
import { WindowPlate } from './shared/WindowPlate'

export function WebsiteNodeBody({
  nodeId,
  isLoading,
  viewportRef,
  displayTitle,
  url,
  browserMode,
  effectiveBrowserMode,
  nativeApiAvailable,
  nativeViewEnabled,
  hasPageUrl,
  lifecycle,
  isCanvasZoomFrozen,
  isOccluded,
  sessionMode,
  profileId,
  browserSearchEngine,
  onOpenAsIframe,
  onNavigateFromHome,
  onInteractionStart,
}: {
  nodeId: string
  isLoading: boolean
  viewportRef: RefObject<HTMLDivElement | null>
  displayTitle: string
  url: string
  browserMode: BrowserMode
  effectiveBrowserMode: BrowserMode
  nativeApiAvailable: boolean
  nativeViewEnabled: boolean
  hasPageUrl: boolean
  lifecycle: WebsiteWindowLifecycle
  isCanvasZoomFrozen: boolean
  isOccluded: boolean
  sessionMode: WebsiteWindowSessionMode
  profileId: string | null
  browserSearchEngine: BrowserSearchEngineId
  onOpenAsIframe: () => void
  onNavigateFromHome: (url: string) => void
  onInteractionStart?: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const snapshotDataUrl = useWebsiteWindowStore(
    state => state.runtimeByNodeId[nodeId]?.snapshotDataUrl ?? null,
  )
  useWebsiteInitialSnapshot({ nodeId, url, lifecycle, isLoading, snapshotDataUrl })
  const showsNativePlaceholder = browserMode === 'native' && !nativeApiAvailable

  return (
    <>
      <WindowPlate kind="media" />
      <div className="website-node__body" data-cove-part="window-body">
        <div ref={viewportRef} className="website-node__viewport" aria-label={displayTitle}>
          {showsNativePlaceholder ? (
            <WebsiteNodeNativePlaceholder onOpenAsIframe={onOpenAsIframe} />
          ) : null}
          {effectiveBrowserMode === 'iframe' && hasPageUrl ? (
            <WebsiteNodeIframe url={url} displayTitle={displayTitle} />
          ) : null}
          {!showsNativePlaceholder && !hasPageUrl ? (
            <WebsiteNodeHomePage
              sessionMode={sessionMode}
              profileId={profileId}
              searchEngine={browserSearchEngine}
              onNavigate={onNavigateFromHome}
              onInteractionStart={onInteractionStart}
            />
          ) : null}
          {nativeViewEnabled &&
          snapshotDataUrl &&
          (lifecycle !== 'active' || isCanvasZoomFrozen || isOccluded) ? (
            <img
              className="website-node__snapshot"
              src={snapshotDataUrl}
              alt={t('websiteNode.snapshotAlt')}
              draggable={false}
            />
          ) : null}
        </div>
      </div>
    </>
  )
}
