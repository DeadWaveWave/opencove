import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useStore } from '@xyflow/react'
import type { WebsiteWindowLifecycle, WebsiteWindowSessionMode } from '@shared/contracts/dto'
import {
  HIDDEN_WEBSITE_BOUNDS,
  resolveViewportFocusRatio,
  resolveViewportState,
  viewportStateEqual,
  type WebsiteViewportState,
} from './WebsiteNode.helpers'

const CANVAS_ZOOM_FREEZE_RELEASE_DELAY_MS = 260
const CANVAS_ZOOM_MIN_LIVE_ENTER = 0.25
const CANVAS_ZOOM_MIN_LIVE_EXIT = 0.28
const VIEWPORT_FOCUS_SNAPSHOT_ENTER_RATIO = 0.8
const VIEWPORT_FOCUS_SNAPSHOT_EXIT_RATIO = 0.7
const VIEWPORT_FOCUS_POLL_INTERVAL_MS = 140
const VIEWPORT_FOCUS_ACTIVATION_GRACE_PERIOD_MS = 900

function resolveCanvasZoomTooSmallForLiveView(nextZoom: number, wasTooSmall: boolean): boolean {
  if (!Number.isFinite(nextZoom) || nextZoom <= 0) {
    return false
  }

  if (wasTooSmall) {
    return nextZoom <= CANVAS_ZOOM_MIN_LIVE_EXIT
  }

  return nextZoom <= CANVAS_ZOOM_MIN_LIVE_ENTER
}

export function useWebsiteNodeNativeView({
  nodeId,
  desiredUrl,
  pinned,
  sessionMode,
  profileId,
  lifecycle,
  isOccluded,
  viewportRef,
}: {
  nodeId: string
  desiredUrl: string
  pinned: boolean
  sessionMode: WebsiteWindowSessionMode
  profileId: string | null
  lifecycle: WebsiteWindowLifecycle
  isOccluded: boolean
  viewportRef: React.RefObject<HTMLDivElement | null>
}): { activate: (desiredUrl: string) => void; isCanvasZoomFrozen: boolean } {
  const desiredUrlRef = useRef(desiredUrl)
  useEffect(() => {
    desiredUrlRef.current = desiredUrl
  }, [desiredUrl])

  const pinnedRef = useRef(pinned)
  useEffect(() => {
    pinnedRef.current = pinned
  }, [pinned])

  const lifecycleRef = useRef(lifecycle)
  useEffect(() => {
    lifecycleRef.current = lifecycle
  }, [lifecycle])

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

  const isViewportFocusSnapshotRef = useRef(false)
  const lastActivatedAtRef = useRef<number | null>(null)

  const isCanvasZoomTooSmallForLiveViewRef = useRef(false)

  const lastCanvasZoomValueRef = useRef(canvasZoom)
  const releaseCanvasZoomFreezeTimerRef = useRef<number | null>(null)
  useEffect(() => {
    if (lifecycle !== 'active' || isOccluded) {
      isCanvasZoomTooSmallForLiveViewRef.current = false
      lastCanvasZoomValueRef.current = canvasZoom
      if (releaseCanvasZoomFreezeTimerRef.current !== null) {
        window.clearTimeout(releaseCanvasZoomFreezeTimerRef.current)
        releaseCanvasZoomFreezeTimerRef.current = null
      }
      if (isCanvasZoomFrozenRef.current) {
        setIsCanvasZoomFrozen(false)
      }
      return
    }

    const wasTooSmallForLive = isCanvasZoomTooSmallForLiveViewRef.current
    const isTooSmallForLive = resolveCanvasZoomTooSmallForLiveView(canvasZoom, wasTooSmallForLive)
    isCanvasZoomTooSmallForLiveViewRef.current = isTooSmallForLive
    if (isTooSmallForLive) {
      lastCanvasZoomValueRef.current = canvasZoom
      if (releaseCanvasZoomFreezeTimerRef.current !== null) {
        window.clearTimeout(releaseCanvasZoomFreezeTimerRef.current)
        releaseCanvasZoomFreezeTimerRef.current = null
      }
      if (!isCanvasZoomFrozenRef.current) {
        setIsCanvasZoomFrozen(true)
      }
      return
    }

    const previousZoom = lastCanvasZoomValueRef.current
    lastCanvasZoomValueRef.current = canvasZoom
    if (previousZoom === canvasZoom) {
      return
    }

    if (releaseCanvasZoomFreezeTimerRef.current !== null) {
      window.clearTimeout(releaseCanvasZoomFreezeTimerRef.current)
    }

    releaseCanvasZoomFreezeTimerRef.current = window.setTimeout(() => {
      const resolvedZoom = canvasZoomRef.current
      const shouldKeepFrozen = resolveCanvasZoomTooSmallForLiveView(
        resolvedZoom,
        isCanvasZoomTooSmallForLiveViewRef.current,
      )
      isCanvasZoomTooSmallForLiveViewRef.current = shouldKeepFrozen
      if (shouldKeepFrozen) {
        setIsCanvasZoomFrozen(true)
        return
      }
      setIsCanvasZoomFrozen(false)
    }, CANVAS_ZOOM_FREEZE_RELEASE_DELAY_MS)

    if (!isCanvasZoomFrozenRef.current) {
      setIsCanvasZoomFrozen(true)
    }
  }, [canvasZoom, isOccluded, lifecycle])

  const activate = useCallback(
    (nextUrl: string) => {
      const api = window.opencoveApi?.websiteWindow
      if (!api || typeof api.activate !== 'function') {
        return
      }

      lastActivatedAtRef.current = performance.now()
      isViewportFocusSnapshotRef.current = false

      const resolvedCanvasZoom = canvasZoomRef.current
      const viewportState = resolveViewportState(viewportRef.current, resolvedCanvasZoom)
      void api
        .activate({
          nodeId,
          url: nextUrl,
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
    if (lifecycle !== 'active' || isCanvasZoomFrozen || isOccluded) {
      lastSentViewportStateRef.current = null
      return
    }

    const api = window.opencoveApi?.websiteWindow
    if (!api || typeof api.setBounds !== 'function') {
      return
    }

    let raf = 0
    const tick = () => {
      if (
        !isViewportFocusSnapshotRef.current &&
        lifecycleRef.current === 'active' &&
        !isCanvasZoomFrozenRef.current
      ) {
        const ratio = resolveViewportFocusRatio(viewportRef.current)
        const lastActivatedAt = lastActivatedAtRef.current
        const shouldRespectGracePeriod =
          lastActivatedAt !== null &&
          performance.now() - lastActivatedAt < VIEWPORT_FOCUS_ACTIVATION_GRACE_PERIOD_MS

        if (
          !shouldRespectGracePeriod &&
          ratio !== null &&
          ratio >= VIEWPORT_FOCUS_SNAPSHOT_ENTER_RATIO
        ) {
          const websiteApi = window.opencoveApi?.websiteWindow
          if (websiteApi && typeof websiteApi.deactivate === 'function') {
            isViewportFocusSnapshotRef.current = true
            void websiteApi.deactivate({ nodeId }).catch(() => {
              isViewportFocusSnapshotRef.current = false
            })
          }
        }
      }

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
  }, [isCanvasZoomFrozen, isOccluded, lifecycle, nodeId, viewportRef])

  useEffect(() => {
    if (lifecycle === 'active' || isOccluded) {
      return
    }

    if (!isViewportFocusSnapshotRef.current && !(lifecycle === 'cold' && pinned)) {
      return
    }

    let intervalId: number | null = null

    const stop = () => {
      if (intervalId === null) {
        return
      }
      window.clearInterval(intervalId)
      intervalId = null
    }

    const tick = () => {
      const ratio = resolveViewportFocusRatio(viewportRef.current)
      if (ratio === null || ratio > VIEWPORT_FOCUS_SNAPSHOT_EXIT_RATIO) {
        return
      }

      const currentLifecycle = lifecycleRef.current
      const shouldRestore =
        currentLifecycle === 'warm' || (currentLifecycle === 'cold' && pinnedRef.current)

      if (!shouldRestore) {
        isViewportFocusSnapshotRef.current = false
        stop()
        return
      }

      const nextUrl = desiredUrlRef.current.trim()
      if (nextUrl.length === 0) {
        isViewportFocusSnapshotRef.current = false
        stop()
        return
      }

      isViewportFocusSnapshotRef.current = false
      stop()
      activate(nextUrl)
    }

    intervalId = window.setInterval(tick, VIEWPORT_FOCUS_POLL_INTERVAL_MS)
    tick()

    return () => {
      stop()
    }
  }, [activate, isOccluded, lifecycle, pinned, viewportRef])

  useLayoutEffect(() => {
    if (lifecycle !== 'active' || isCanvasZoomFrozen || isOccluded) {
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
  }, [canvasZoom, isCanvasZoomFrozen, isOccluded, lifecycle, nodeId, viewportRef])

  useEffect(() => {
    if (lifecycle !== 'active' || isOccluded) {
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
  }, [isCanvasZoomFrozen, isOccluded, lifecycle, nodeId])

  return { activate, isCanvasZoomFrozen }
}
