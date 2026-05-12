import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Globe,
  LoaderCircle,
  Maximize2,
  Minimize2,
  Pin,
  PinOff,
  RotateCw,
  Square,
} from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'
import { resolveBrowserNavigationTarget } from '@contexts/settings/domain/browserSettings'
import type { WebsiteWindowSessionMode } from '@shared/contracts/dto'
import { NodeResizeHandles } from './shared/NodeResizeHandles'
import { useNodeFrameResize } from '../utils/nodeFrameResize'
import { resolveCanonicalNodeMinSize } from '../utils/workspaceNodeSizing'
import { useWebsiteWindowStore } from '../store/useWebsiteWindowStore'
import { useWebsiteNodeNativeView } from './WebsiteNode.nativeView'
import { useWebsiteNodeFrameConstraints } from './WebsiteNode.frame'
import { WebsiteNodeBody } from './WebsiteNode.body'
import { WebsiteNodeBrowserTools } from './WebsiteNode.browserTools'
import type { WebsiteNodeProps } from './WebsiteNode.types'

export function WebsiteNode({
  nodeId,
  title,
  url,
  pinned,
  sessionMode,
  profileId,
  browserMode,
  browserDefaultMode,
  browserSearchEngine,
  isFullscreen,
  previousFrame,
  labelColor,
  position,
  width,
  height,
  onClose,
  onResize,
  onInteractionStart,
  onUrlCommit,
  onPinnedChange,
  onSessionChange,
  onModeChange,
  onFullscreenChange,
}: WebsiteNodeProps): JSX.Element {
  const { t } = useTranslation()
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const runtime = useWebsiteWindowStore(state => state.runtimeByNodeId[nodeId] ?? null)
  const lifecycle = runtime?.lifecycle ?? 'cold'
  const isOccluded = runtime?.isOccluded === true
  const nativeApiAvailable = typeof window.opencoveApi?.websiteWindow?.activate === 'function'
  const effectiveBrowserMode = nativeApiAvailable ? browserDefaultMode : browserMode
  const hasPageUrl = url.trim().length > 0
  const nativeRuntimeAvailable = effectiveBrowserMode === 'native' && nativeApiAvailable
  const nativeViewEnabled = nativeRuntimeAvailable && hasPageUrl
  const { activate, isCanvasZoomFrozen } = useWebsiteNodeNativeView({
    nodeId,
    desiredUrl: url,
    pinned,
    sessionMode,
    profileId,
    enabled: nativeRuntimeAvailable,
    lifecycle,
    isOccluded,
    viewportRef,
  })
  const { maxNodeSize, toggleFullscreen } = useWebsiteNodeFrameConstraints({
    viewportRef,
    position,
    width,
    height,
    isFullscreen,
    previousFrame,
    onResize,
    onFullscreenChange,
  })

  const { draftFrame, handleResizePointerDown } = useNodeFrameResize({
    position,
    width,
    height,
    minSize: resolveCanonicalNodeMinSize('website'),
    maxSize: isFullscreen ? null : maxNodeSize,
    onResize,
  })

  const renderedFrame = draftFrame ?? {
    position,
    size: { width, height },
  }

  const style = useMemo(
    () => ({
      width: renderedFrame.size.width,
      height: renderedFrame.size.height,
      transform:
        renderedFrame.position.x !== position.x || renderedFrame.position.y !== position.y
          ? `translate(${renderedFrame.position.x - position.x}px, ${renderedFrame.position.y - position.y}px)`
          : undefined,
    }),
    [
      position.x,
      position.y,
      renderedFrame.position.x,
      renderedFrame.position.y,
      renderedFrame.size.height,
      renderedFrame.size.width,
    ],
  )

  const [draftUrl, setDraftUrl] = useState(url)
  const [findRequestId, setFindRequestId] = useState(0)
  useEffect(() => {
    setDraftUrl(url)
  }, [url])

  const [draftProfileId, setDraftProfileId] = useState(profileId ?? '')
  useEffect(() => {
    setDraftProfileId(profileId ?? '')
  }, [profileId, sessionMode])

  const canGoBack = runtime?.canGoBack === true
  const canGoForward = runtime?.canGoForward === true
  const isLoading = runtime?.isLoading === true
  const currentUrl = hasPageUrl ? (runtime?.url ?? url) : ''
  const effectiveFindRequestId = Math.max(findRequestId, runtime?.findRequestId ?? 0)

  useEffect(() => {
    if (nativeViewEnabled) {
      return
    }

    void window.opencoveApi?.websiteWindow?.close?.({ nodeId }).catch(() => undefined)
  }, [nativeViewEnabled, nodeId])

  useEffect(() => {
    const runtimeUrl = runtime?.url?.trim() ?? ''
    const committedUrl = url.trim()
    if (committedUrl.length === 0) {
      return
    }
    if (runtimeUrl.length === 0 || runtimeUrl === committedUrl) {
      return
    }

    onUrlCommit(runtimeUrl)
  }, [onUrlCommit, runtime?.url, url])

  const commitUrl = useCallback(() => {
    const nextUrl = resolveBrowserNavigationTarget(draftUrl, browserSearchEngine)
    if (nextUrl === null) {
      return
    }

    onUrlCommit(nextUrl)
    if (nativeRuntimeAvailable && nextUrl.trim().length > 0) {
      activate(nextUrl)
    }
  }, [activate, browserSearchEngine, draftUrl, nativeRuntimeAvailable, onUrlCommit])

  const togglePinned = useCallback(() => {
    const nextPinned = pinned !== true
    onPinnedChange(nextPinned)
    void window.opencoveApi?.websiteWindow
      ?.setPinned?.({ nodeId, pinned: nextPinned })
      .catch(() => undefined)
  }, [nodeId, onPinnedChange, pinned])

  const handleSessionChange = useCallback(
    (nextMode: WebsiteWindowSessionMode, nextProfileId: string | null) => {
      onSessionChange(nextMode, nextProfileId)
      void window.opencoveApi?.websiteWindow
        ?.setSession?.({
          nodeId,
          sessionMode: nextMode,
          profileId: nextProfileId,
        })
        .catch(() => undefined)
    },
    [nodeId, onSessionChange],
  )

  const commitProfileId = useCallback(() => {
    const next = draftProfileId.trim()
    handleSessionChange('profile', next.length > 0 ? next : null)
  }, [draftProfileId, handleSessionChange])

  const displayTitle = runtime?.title?.trim().length ? runtime.title : title
  const snapshotDataUrl = runtime?.snapshotDataUrl ?? null
  const hasRequestedInitialSnapshotRef = useRef(false)

  useEffect(() => {
    if (lifecycle !== 'active') {
      hasRequestedInitialSnapshotRef.current = false
      return
    }

    if (url.trim().length === 0) {
      return
    }

    if (isLoading || snapshotDataUrl) {
      return
    }

    if (hasRequestedInitialSnapshotRef.current) {
      return
    }

    const api = window.opencoveApi?.websiteWindow
    if (!api || typeof api.captureSnapshot !== 'function') {
      return
    }

    hasRequestedInitialSnapshotRef.current = true
    api.captureSnapshot({ nodeId, quality: 60 })
  }, [isLoading, lifecycle, nodeId, snapshotDataUrl, url])

  return (
    <div
      className="website-node nowheel"
      style={style}
      onKeyDownCapture={event => {
        const isFindShortcut =
          (event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'f'
        if (!isFindShortcut || effectiveBrowserMode !== 'native' || !nativeApiAvailable) {
          return
        }

        event.preventDefault()
        event.stopPropagation()
        setFindRequestId(value => value + 1)
      }}
      onClickCapture={event => {
        if (event.button !== 0 || !(event.target instanceof Element)) {
          return
        }

        if (event.target.closest('.nodrag')) {
          return
        }

        event.stopPropagation()
        onInteractionStart?.({ shiftKey: event.shiftKey })
        if (nativeViewEnabled) {
          activate(url)
        }
      }}
    >
      <div className="website-node__surface">
        <div className="website-node__header" data-node-drag-handle="true">
          {labelColor ? (
            <span
              className="cove-label-dot cove-label-dot--solid"
              data-cove-label-color={labelColor}
              aria-hidden="true"
            />
          ) : null}

          <div className="website-node__nav">
            <button
              type="button"
              className="website-node__icon-button nodrag"
              onClick={event => {
                event.stopPropagation()
                void window.opencoveApi?.websiteWindow?.goBack?.({ nodeId }).catch(() => undefined)
              }}
              disabled={!canGoBack}
              aria-label={t('websiteNode.back')}
              title={t('websiteNode.back')}
            >
              <ArrowLeft aria-hidden="true" />
            </button>

            <button
              type="button"
              className="website-node__icon-button nodrag"
              onClick={event => {
                event.stopPropagation()
                void window.opencoveApi?.websiteWindow
                  ?.goForward?.({ nodeId })
                  .catch(() => undefined)
              }}
              disabled={!canGoForward}
              aria-label={t('websiteNode.forward')}
              title={t('websiteNode.forward')}
            >
              <ArrowRight aria-hidden="true" />
            </button>

            <button
              type="button"
              className="website-node__icon-button nodrag"
              onClick={event => {
                event.stopPropagation()
                const api = window.opencoveApi?.websiteWindow
                if (isLoading) {
                  void api?.stop?.({ nodeId }).catch(() => undefined)
                  return
                }

                void api?.reload?.({ nodeId }).catch(() => undefined)
              }}
              aria-label={isLoading ? t('websiteNode.stop') : t('websiteNode.reload')}
              title={isLoading ? t('websiteNode.stop') : t('websiteNode.reload')}
            >
              {isLoading ? <Square aria-hidden="true" /> : <RotateCw aria-hidden="true" />}
            </button>
          </div>

          <form
            className="website-node__address nodrag"
            onSubmit={event => {
              event.preventDefault()
              event.stopPropagation()
              commitUrl()
            }}
          >
            <Globe className="website-node__address-icon" aria-hidden="true" />
            <input
              className="website-node__address-input"
              value={draftUrl}
              onChange={event => {
                setDraftUrl(event.target.value)
              }}
              placeholder={t('websiteNode.urlPlaceholder')}
              aria-label={t('websiteNode.urlPlaceholder')}
              onFocus={() => {
                onInteractionStart?.({ normalizeViewport: false, selectNode: false })
              }}
            />
            {isLoading ? (
              <LoaderCircle className="website-node__spinner" aria-hidden="true" />
            ) : null}
          </form>

          <div className="website-node__actions">
            {lifecycle === 'cold' ? (
              <span className="website-node__status" aria-label="cold">
                zzz
              </span>
            ) : null}

            <button
              type="button"
              className="website-node__icon-button nodrag"
              onClick={event => {
                event.stopPropagation()
                togglePinned()
              }}
              aria-label={pinned ? t('websiteNode.unpin') : t('websiteNode.pin')}
              title={pinned ? t('websiteNode.unpin') : t('websiteNode.pin')}
            >
              {pinned ? <PinOff aria-hidden="true" /> : <Pin aria-hidden="true" />}
            </button>

            <button
              type="button"
              className="website-node__icon-button nodrag"
              onClick={event => {
                event.stopPropagation()
                toggleFullscreen()
              }}
              aria-label={
                isFullscreen ? t('websiteNode.exitFullscreen') : t('websiteNode.enterFullscreen')
              }
              title={
                isFullscreen ? t('websiteNode.exitFullscreen') : t('websiteNode.enterFullscreen')
              }
            >
              {isFullscreen ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
            </button>

            <select
              className="website-node__session nodrag"
              value={sessionMode}
              aria-label={t('websiteNode.sessionMode')}
              title={t('websiteNode.sessionMode')}
              onChange={event => {
                const nextMode = event.target.value as WebsiteWindowSessionMode
                handleSessionChange(nextMode, nextMode === 'profile' ? profileId : null)
              }}
            >
              <option value="shared">{t('websiteNode.sessionShared')}</option>
              <option value="incognito">{t('websiteNode.sessionIncognito')}</option>
              <option value="profile">{t('websiteNode.sessionProfile')}</option>
            </select>

            {sessionMode === 'profile' ? (
              <input
                className="website-node__profile nodrag"
                value={draftProfileId}
                placeholder={t('websiteNode.profilePlaceholder')}
                aria-label={t('websiteNode.profilePlaceholder')}
                onChange={event => {
                  setDraftProfileId(event.target.value)
                }}
                onKeyDown={event => {
                  if (event.key !== 'Enter') {
                    return
                  }

                  event.preventDefault()
                  event.stopPropagation()
                  commitProfileId()
                }}
                onBlur={() => {
                  commitProfileId()
                }}
                onFocus={() => {
                  onInteractionStart?.({ normalizeViewport: false, selectNode: false })
                }}
              />
            ) : null}

            <button
              type="button"
              className="website-node__close nodrag"
              onClick={event => {
                event.stopPropagation()
                onClose()
              }}
              aria-label={t('websiteNode.close')}
              title={t('websiteNode.close')}
            >
              ×
            </button>
          </div>
        </div>

        <WebsiteNodeBrowserTools
          nodeId={nodeId}
          url={url}
          currentUrl={currentUrl}
          title={displayTitle}
          faviconUrl={runtime?.faviconUrl ?? null}
          sessionMode={sessionMode}
          profileId={profileId}
          browserMode={effectiveBrowserMode}
          nativeApiAvailable={nativeApiAvailable}
          findResult={runtime?.findResult ?? null}
          findRequestId={effectiveFindRequestId}
          downloads={runtime?.downloads ?? []}
          permissionRequests={runtime?.permissionRequests ?? []}
          onNavigate={nextUrl => {
            onUrlCommit(nextUrl)
            if (nativeRuntimeAvailable && nextUrl.trim().length > 0) {
              activate(nextUrl)
            }
          }}
          onInteractionStart={() => {
            onInteractionStart?.({ normalizeViewport: false, selectNode: false })
          }}
        />

        <WebsiteNodeBody
          viewportRef={viewportRef}
          displayTitle={displayTitle}
          url={url}
          browserMode={browserMode}
          effectiveBrowserMode={effectiveBrowserMode}
          nativeApiAvailable={nativeApiAvailable}
          nativeViewEnabled={nativeViewEnabled}
          hasPageUrl={hasPageUrl}
          lifecycle={lifecycle}
          isCanvasZoomFrozen={isCanvasZoomFrozen}
          isOccluded={isOccluded}
          snapshotDataUrl={snapshotDataUrl}
          sessionMode={sessionMode}
          profileId={profileId}
          browserSearchEngine={browserSearchEngine}
          onOpenAsIframe={() => onModeChange('iframe')}
          onNavigateFromHome={nextUrl => {
            onUrlCommit(nextUrl)
            if (nativeRuntimeAvailable && nextUrl.trim().length > 0) {
              activate(nextUrl)
            }
          }}
          onInteractionStart={() => {
            onInteractionStart?.({ normalizeViewport: false, selectNode: false })
          }}
        />
      </div>

      <NodeResizeHandles
        classNamePrefix="website-node"
        testIdPrefix="website-resizer"
        handleResizePointerDown={handleResizePointerDown}
      />
    </div>
  )
}
