import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useStore } from '@xyflow/react'
import type { WebsiteWindowLifecycle, WebsiteWindowSessionMode } from '@shared/contracts/dto'
import {
  HIDDEN_WEBSITE_BOUNDS,
  resolveViewportState,
  viewportStateEqual,
  type WebsiteViewportState,
} from './WebsiteNode.helpers'

const CANVAS_ZOOM_FREEZE_TRIGGER_WINDOW_MS = 90
const CANVAS_ZOOM_FREEZE_RELEASE_DELAY_MS = 180

export function useWebsiteNodeNativeView({
  nodeId,
  pinned,
  sessionMode,
  profileId,
  lifecycle,
  viewportRef,
}: {
  nodeId: string
  pinned: boolean
  sessionMode: WebsiteWindowSessionMode
  profileId: string | null
  lifecycle: WebsiteWindowLifecycle
  viewportRef: React.RefObject<HTMLDivElement | null>
}): { activate: (desiredUrl: string) => void; isCanvasZoomFrozen: boolean } {
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

  const [isCanvasZoomFrozen, setIsCanvasZoomFrozen] = useState(false)
  const isCanvasZoomFrozenRef = useRef(isCanvasZoomFrozen)
  useEffect(() => {
    isCanvasZoomFrozenRef.current = isCanvasZoomFrozen
  }, [isCanvasZoomFrozen])

  const lastCanvasZoomChangedAtRef = useRef<number | null>(null)
  const releaseCanvasZoomFreezeTimerRef = useRef<number | null>(null)
  useEffect(() => {
    if (lifecycle !== 'active') {
      lastCanvasZoomChangedAtRef.current = null
      if (releaseCanvasZoomFreezeTimerRef.current !== null) {
        window.clearTimeout(releaseCanvasZoomFreezeTimerRef.current)
        releaseCanvasZoomFreezeTimerRef.current = null
      }
      if (isCanvasZoomFrozenRef.current) {
        setIsCanvasZoomFrozen(false)
      }
      return
    }

    const now = performance.now()
    const lastChangedAt = lastCanvasZoomChangedAtRef.current
    lastCanvasZoomChangedAtRef.current = now

    if (releaseCanvasZoomFreezeTimerRef.current !== null) {
      window.clearTimeout(releaseCanvasZoomFreezeTimerRef.current)
    }

    releaseCanvasZoomFreezeTimerRef.current = window.setTimeout(() => {
      setIsCanvasZoomFrozen(false)
    }, CANVAS_ZOOM_FREEZE_RELEASE_DELAY_MS)

    if (isCanvasZoomFrozenRef.current) {
      return
    }

    if (lastChangedAt !== null && now - lastChangedAt < CANVAS_ZOOM_FREEZE_TRIGGER_WINDOW_MS) {
      setIsCanvasZoomFrozen(true)
    }
  }, [canvasZoom, lifecycle])

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
          viewportBounds: viewportState?.viewportBounds ?? HIDDEN_WEBSITE_BOUNDS,
          canvasZoom: resolvedCanvasZoom,
        })
        .catch(() => undefined)
    },
    [nodeId, pinned, profileId, sessionMode, viewportRef],
  )

  const lastSentViewportStateRef = useRef<WebsiteViewportState | null>(null)
  useEffect(() => {
    if (lifecycle !== 'active' || isCanvasZoomFrozen) {
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
        viewportBounds: HIDDEN_WEBSITE_BOUNDS,
        canvasZoom: resolvedCanvasZoom,
      }
      if (viewportState && !viewportStateEqual(lastSentViewportStateRef.current, viewportState)) {
        lastSentViewportStateRef.current = viewportState
        api.setBounds({
          nodeId,
          bounds: viewportState.bounds,
          viewportBounds: viewportState.viewportBounds,
          canvasZoom: viewportState.canvasZoom,
        })
      }

      raf = window.requestAnimationFrame(tick)
    }

    raf = window.requestAnimationFrame(tick)
    return () => {
      window.cancelAnimationFrame(raf)
    }
  }, [isCanvasZoomFrozen, lifecycle, nodeId, viewportRef])

  useLayoutEffect(() => {
    if (lifecycle !== 'active' || isCanvasZoomFrozen) {
      return
    }

    const api = window.opencoveApi?.websiteWindow
    if (!api || typeof api.setBounds !== 'function') {
      return
    }

    const viewportState = resolveViewportState(viewportRef.current, canvasZoom) ?? {
      bounds: HIDDEN_WEBSITE_BOUNDS,
      viewportBounds: HIDDEN_WEBSITE_BOUNDS,
      canvasZoom,
    }

    if (!viewportStateEqual(lastSentViewportStateRef.current, viewportState)) {
      lastSentViewportStateRef.current = viewportState
      api.setBounds({
        nodeId,
        bounds: viewportState.bounds,
        viewportBounds: viewportState.viewportBounds,
        canvasZoom: viewportState.canvasZoom,
      })
    }
  }, [canvasZoom, isCanvasZoomFrozen, lifecycle, nodeId, viewportRef])

  useEffect(() => {
    if (lifecycle !== 'active') {
      return
    }

    const api = window.opencoveApi?.websiteWindow
    if (!api || typeof api.setBounds !== 'function') {
      return
    }

    if (!isCanvasZoomFrozen) {
      return
    }

    lastSentViewportStateRef.current = null
    if (typeof api.captureSnapshot === 'function') {
      api.captureSnapshot({ nodeId, quality: 58 })
    }
    api.setBounds({
      nodeId,
      bounds: HIDDEN_WEBSITE_BOUNDS,
      viewportBounds: HIDDEN_WEBSITE_BOUNDS,
    })
  }, [isCanvasZoomFrozen, lifecycle, nodeId])

  return { activate, isCanvasZoomFrozen }
}
