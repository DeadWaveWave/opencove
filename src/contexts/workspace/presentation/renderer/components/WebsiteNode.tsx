import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import { ArrowLeft, ArrowRight, Globe, LoaderCircle, Pin, PinOff, RotateCw } from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'
import { useStore } from '@xyflow/react'
import type { LabelColor } from '@shared/types/labelColor'
import type { WebsiteWindowSessionMode } from '@shared/contracts/dto'
import type { NodeFrame, Point } from '../types'
import { NodeResizeHandles } from './shared/NodeResizeHandles'
import {
  HIDDEN_WEBSITE_BOUNDS,
  resolveViewportState,
  viewportStateEqual,
} from './WebsiteNode.helpers'
import type { WebsiteViewportState } from './WebsiteNode.helpers'
import { useNodeFrameResize } from '../utils/nodeFrameResize'
import { resolveCanonicalNodeMinSize } from '../utils/workspaceNodeSizing'
import { useWebsiteWindowStore } from '../store/useWebsiteWindowStore'

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
  const canvasZoom = useStore(storeState => {
    const state = storeState as unknown as { transform?: [number, number, number] }
    const zoom = state.transform?.[2] ?? 1
    const normalized = Number.isFinite(zoom) && zoom > 0 ? zoom : 1
    const clamped = Math.min(2, Math.max(0.1, normalized))
    return Math.round(clamped * 1000) / 1000
  })
  const canvasZoomRef = useRef(canvasZoom)
  useLayoutEffect(() => {
    canvasZoomRef.current = canvasZoom
  }, [canvasZoom])

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

  const activate = useCallback(
    (desiredUrl: string) => {
      const api = window.opencoveApi?.websiteWindow
      if (!api || typeof api.activate !== 'function') {
        return
      }

      const resolvedCanvasZoom = canvasZoomRef.current
      const viewportState = resolveViewportState(viewportRef.current, resolvedCanvasZoom)
      void api
        .activate({
          nodeId,
          url: desiredUrl,
          pinned,
          sessionMode,
          profileId,
          bounds: viewportState?.bounds ?? HIDDEN_WEBSITE_BOUNDS,
          canvasZoom: resolvedCanvasZoom,
        })
        .catch(() => undefined)
    },
    [nodeId, pinned, profileId, sessionMode],
  )

  const lastSentViewportStateRef = useRef<WebsiteViewportState | null>(null)
  useEffect(() => {
    if (lifecycle !== 'active') {
      lastSentViewportStateRef.current = null
      return
    }

    const api = window.opencoveApi?.websiteWindow
    if (!api || typeof api.setBounds !== 'function') {
      return
    }

    let raf = 0
    const tick = () => {
      const resolvedCanvasZoom = canvasZoomRef.current
      const viewportState = resolveViewportState(viewportRef.current, resolvedCanvasZoom) ?? {
        bounds: HIDDEN_WEBSITE_BOUNDS,
        canvasZoom: resolvedCanvasZoom,
      }
      if (viewportState && !viewportStateEqual(lastSentViewportStateRef.current, viewportState)) {
        lastSentViewportStateRef.current = viewportState
        api.setBounds({
          nodeId,
          bounds: viewportState.bounds,
          canvasZoom: viewportState.canvasZoom,
        })
      }

      raf = window.requestAnimationFrame(tick)
    }

    raf = window.requestAnimationFrame(tick)
    return () => {
      window.cancelAnimationFrame(raf)
    }
  }, [lifecycle, nodeId])

  useLayoutEffect(() => {
    if (lifecycle !== 'active') {
      return
    }

    const api = window.opencoveApi?.websiteWindow
    if (!api || typeof api.setBounds !== 'function') {
      return
    }

    const viewportState = resolveViewportState(viewportRef.current, canvasZoom) ?? {
      bounds: HIDDEN_WEBSITE_BOUNDS,
      canvasZoom,
    }

    if (!viewportStateEqual(lastSentViewportStateRef.current, viewportState)) {
      lastSentViewportStateRef.current = viewportState
      api.setBounds({
        nodeId,
        bounds: viewportState.bounds,
        canvasZoom: viewportState.canvasZoom,
      })
    }
  }, [canvasZoom, lifecycle, nodeId])

  const canGoBack = runtime?.canGoBack === true
  const canGoForward = runtime?.canGoForward === true
  const isLoading = runtime?.isLoading === true

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
  const overlayHint =
    url.trim().length === 0
      ? t('websiteNode.emptyHint')
      : lifecycle === 'warm'
        ? t('websiteNode.warmHint')
        : t('websiteNode.coldHint')

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
            {lifecycle !== 'active' && snapshotDataUrl ? (
              <img
                className="website-node__snapshot"
                src={snapshotDataUrl}
                alt={t('websiteNode.snapshotAlt')}
                draggable={false}
              />
            ) : null}

            {lifecycle !== 'active' ? (
              <div className="website-node__overlay" aria-hidden="true">
                <div className="website-node__overlay-badge">
                  <div className="website-node__overlay-title">{displayTitle}</div>
                  <div className="website-node__overlay-subtitle">{overlayHint}</div>
                </div>
              </div>
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
