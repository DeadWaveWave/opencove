import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import { ArrowLeft, ArrowRight, Globe, LoaderCircle, Pin, PinOff, RotateCw } from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'
import type { LabelColor } from '@shared/types/labelColor'
import type { WebsiteWindowSessionMode } from '@shared/contracts/dto'
import type { NodeFrame, Point } from '../types'
import { NodeResizeHandles } from './shared/NodeResizeHandles'
import { useNodeFrameResize } from '../utils/nodeFrameResize'
import { resolveCanonicalNodeMinSize } from '../utils/workspaceNodeSizing'
import { useWebsiteWindowStore } from '../store/useWebsiteWindowStore'
import { useWebsiteNodeNativeView } from './WebsiteNode.nativeView'

interface WebsiteNodeInteractionOptions {
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
}

export function WebsiteNode({
  nodeId,
  title,
  url,
  pinned,
  sessionMode,
  profileId,
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
}: WebsiteNodeProps): JSX.Element {
  const { t } = useTranslation()
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const runtime = useWebsiteWindowStore(state => state.runtimeByNodeId[nodeId] ?? null)
  const lifecycle = runtime?.lifecycle ?? 'cold'
  const isOccluded = runtime?.isOccluded === true
  const { activate, isCanvasZoomFrozen } = useWebsiteNodeNativeView({
    nodeId,
    desiredUrl: url,
    pinned,
    sessionMode,
    profileId,
    lifecycle,
    isOccluded,
    viewportRef,
  })

  const { draftFrame, handleResizePointerDown } = useNodeFrameResize({
    position,
    width,
    height,
    minSize: resolveCanonicalNodeMinSize('website'),
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

  useEffect(() => {
    const runtimeUrl = runtime?.url?.trim() ?? ''
    const currentUrl = url.trim()
    if (runtimeUrl.length === 0 || runtimeUrl === currentUrl) {
      return
    }

    onUrlCommit(runtimeUrl)
  }, [onUrlCommit, runtime?.url, url])

  const commitUrl = useCallback(() => {
    const nextUrl = draftUrl.trim()
    onUrlCommit(nextUrl)
    activate(nextUrl)
  }, [activate, draftUrl, onUrlCommit])

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
      onClickCapture={event => {
        if (event.button !== 0 || !(event.target instanceof Element)) {
          return
        }

        if (event.target.closest('.nodrag')) {
          return
        }

        event.stopPropagation()
        onInteractionStart?.({ shiftKey: event.shiftKey })
        activate(url)
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
                void window.opencoveApi?.websiteWindow?.reload?.({ nodeId }).catch(() => undefined)
              }}
              aria-label={t('websiteNode.reload')}
              title={t('websiteNode.reload')}
            >
              <RotateCw aria-hidden="true" />
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

        <div className="website-node__body">
          <div ref={viewportRef} className="website-node__viewport" aria-label={displayTitle}>
            {snapshotDataUrl && (lifecycle !== 'active' || isCanvasZoomFrozen || isOccluded) ? (
              <img
                className="website-node__snapshot"
                src={snapshotDataUrl}
                alt={t('websiteNode.snapshotAlt')}
                draggable={false}
              />
            ) : null}
          </div>
        </div>
      </div>

      <NodeResizeHandles
        classNamePrefix="website-node"
        testIdPrefix="website-resizer"
        handleResizePointerDown={handleResizePointerDown}
      />
    </div>
  )
}
