import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useStoreApi } from '@xyflow/react'
import type { WebsiteWindowLifecycle, WebsiteWindowSessionMode } from '@shared/contracts/dto'
import {
  HIDDEN_WEBSITE_BOUNDS,
  resolveViewportFocusRatio,
  resolveViewportState,
  viewportStateEqual,
  type WebsiteViewportState,
} from './WebsiteNode.helpers'
import { resolveCanvasLod } from './workspaceCanvas/view/canvasLod'

const CANVAS_ZOOM_FREEZE_RELEASE_DELAY_MS = 260
const VIEWPORT_FOCUS_SNAPSHOT_ENTER_RATIO = 0.8
const VIEWPORT_FOCUS_SNAPSHOT_EXIT_RATIO = 0.7
const VIEWPORT_FOCUS_POLL_INTERVAL_MS = 140
const VIEWPORT_FOCUS_ACTIVATION_GRACE_PERIOD_MS = 900

/** Preserve the browser's existing zoom-factor precision independently of DOM bounds. */
function normalizeCanvasZoom(zoom: number): number {
  const normalized = Number.isFinite(zoom) && zoom > 0 ? zoom : 1
  return Math.round(Math.min(2, Math.max(0.1, normalized)) * 1000) / 1000
}

/** Native views freeze on the canvas's far-view thresholds, whether or not far view is drawn. */
function resolveCanvasZoomTooSmallForLiveView(nextZoom: number, wasTooSmall: boolean): boolean {
  return resolveCanvasLod(nextZoom, wasTooSmall ? 'far' : 'near') === 'far'
}

export function useWebsiteNodeNativeView({
  nodeId,
  desiredUrl,
  pinned,
  sessionMode,
  profileId,
  enabled,
  lifecycle,
  isOccluded,
  viewportRef,
  presentationHidden = false,
}: {
  nodeId: string
  desiredUrl: string
  pinned: boolean
  sessionMode: WebsiteWindowSessionMode
  profileId: string | null
  enabled: boolean
  lifecycle: WebsiteWindowLifecycle
  isOccluded: boolean
  viewportRef: React.RefObject<HTMLDivElement | null>
  presentationHidden?: boolean
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

  const store = useStoreApi()
  const canvasZoomRef = useRef(normalizeCanvasZoom(store.getState().transform[2]))
  const [isCanvasZoomFrozen, setIsCanvasZoomFrozen] = useState(false)
  const isCanvasZoomFrozenRef = useRef(false)
  const isViewportFocusSnapshotRef = useRef(false)
  const lastActivatedAtRef = useRef<number | null>(null)
  const isCanvasZoomTooSmallForLiveViewRef = useRef(false)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let zoom = canvasZoomRef.current
    const freeze = (next: boolean) => {
      if (isCanvasZoomFrozenRef.current === next) {
        return
      }
      isCanvasZoomFrozenRef.current = next
      setIsCanvasZoomFrozen(next)
    }
    const sync = () => {
      const nextZoom = normalizeCanvasZoom(store.getState().transform[2])
      canvasZoomRef.current = nextZoom
      if (lifecycle !== 'active' || isOccluded) {
        isCanvasZoomTooSmallForLiveViewRef.current = false
        zoom = nextZoom
        clearTimeout(timer)
        freeze(false)
        return
      }
      const tooSmall = resolveCanvasZoomTooSmallForLiveView(
        nextZoom,
        isCanvasZoomTooSmallForLiveViewRef.current,
      )
      isCanvasZoomTooSmallForLiveViewRef.current = tooSmall
      if (tooSmall) {
        zoom = nextZoom
        clearTimeout(timer)
        freeze(true)
        return
      }
      if (zoom === nextZoom) {
        return
      }
      zoom = nextZoom
      clearTimeout(timer)
      freeze(true)
      timer = setTimeout(() => freeze(false), CANVAS_ZOOM_FREEZE_RELEASE_DELAY_MS)
    }
    sync()
    const unsubscribe = store.subscribe(sync)
    return () => {
      clearTimeout(timer)
      unsubscribe()
    }
  }, [isOccluded, lifecycle, store])

  const activate = useCallback(
    (nextUrl: string) => {
      const api = window.opencoveApi?.websiteWindow
      if (presentationHidden || !enabled || !api || typeof api.activate !== 'function') {
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
    [enabled, nodeId, pinned, presentationHidden, profileId, sessionMode, viewportRef],
  )

  const lastSentViewportStateRef = useRef<WebsiteViewportState | null>(null)
  useEffect(() => {
    if (
      presentationHidden ||
      !enabled ||
      lifecycle !== 'active' ||
      isCanvasZoomFrozen ||
      isOccluded
    ) {
      lastSentViewportStateRef.current = null
      return
    }

    const api = window.opencoveApi?.websiteWindow
    if (!api || typeof api.setBounds !== 'function') {
      return
    }

    let raf = 0
    const tick = () => {
      if (isCanvasZoomFrozenRef.current) {
        raf = window.requestAnimationFrame(tick)
        return
      }
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
  }, [enabled, isCanvasZoomFrozen, isOccluded, lifecycle, nodeId, presentationHidden, viewportRef])

  useEffect(() => {
    if (presentationHidden || !enabled || lifecycle === 'active' || isOccluded) {
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
  }, [activate, enabled, isOccluded, lifecycle, pinned, presentationHidden, viewportRef])

  useLayoutEffect(() => {
    if (
      presentationHidden ||
      !enabled ||
      lifecycle !== 'active' ||
      isCanvasZoomFrozen ||
      isOccluded
    ) {
      return
    }

    const api = window.opencoveApi?.websiteWindow
    if (!api || typeof api.setBounds !== 'function') {
      return
    }

    const canvasZoom = canvasZoomRef.current
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
  }, [enabled, isCanvasZoomFrozen, isOccluded, lifecycle, nodeId, presentationHidden, viewportRef])

  useLayoutEffect(() => {
    // Update durable presentation bounds even under a menu/modal, so lifting
    // global occlusion cannot briefly restore an already-collapsed native view.
    if (lifecycle !== 'active' || (isOccluded && !presentationHidden)) {
      return
    }

    const api = window.opencoveApi?.websiteWindow
    if (!api || typeof api.setBounds !== 'function') {
      return
    }

    if (!isCanvasZoomFrozen && !presentationHidden) {
      return
    }

    lastSentViewportStateRef.current = null
    if (!presentationHidden && typeof api.captureSnapshot === 'function') {
      api.captureSnapshot({ nodeId, quality: 58 })
    }
    api.setBounds({
      nodeId,
      bounds: HIDDEN_WEBSITE_BOUNDS,
      viewportBounds: presentationHidden
        ? (resolveViewportState(viewportRef.current, canvasZoomRef.current)?.viewportBounds ??
          HIDDEN_WEBSITE_BOUNDS)
        : HIDDEN_WEBSITE_BOUNDS,
    })
  }, [isCanvasZoomFrozen, isOccluded, lifecycle, nodeId, presentationHidden, viewportRef])

  return { activate, isCanvasZoomFrozen }
}
