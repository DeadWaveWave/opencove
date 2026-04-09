import { useCallback, useEffect, useRef, type MutableRefObject } from 'react'
import { useStoreApi, type Node, type ReactFlowInstance, type Viewport } from '@xyflow/react'
import type {
  CanvasWheelBehavior,
  CanvasWheelZoomModifier,
} from '@contexts/settings/domain/agentSettings'
import {
  isPinchLikeZoomWheelSample,
  type CanvasInputModalityState,
  type DetectedCanvasInputMode,
  type WheelInputSample,
} from '../../../utils/inputModality'
import type { TerminalNodeData } from '../../../types'
import { MAX_CANVAS_ZOOM, MIN_CANVAS_ZOOM, TRACKPAD_PAN_SCROLL_SPEED } from '../constants'
import { clampNumber, resolveWheelTarget } from '../helpers'
import type { TrackpadGestureLockState } from '../types'
import { resolveCanvasWheelGesture } from '../wheelGestures'

interface UseTrackpadGesturesParams {
  canvasInputModeSetting: 'mouse' | 'trackpad' | 'auto'
  canvasWheelBehaviorSetting: CanvasWheelBehavior
  canvasWheelZoomModifierSetting: CanvasWheelZoomModifier
  resolvedCanvasInputMode: DetectedCanvasInputMode
  inputModalityStateRef: MutableRefObject<CanvasInputModalityState>
  setDetectedCanvasInputMode: React.Dispatch<React.SetStateAction<DetectedCanvasInputMode>>
  canvasRef: MutableRefObject<HTMLDivElement | null>
  trackpadGestureLockRef: MutableRefObject<TrackpadGestureLockState | null>
  viewportRef: MutableRefObject<Viewport>
  reactFlow: ReactFlowInstance<Node<TerminalNodeData>>
  onViewportChange: (viewport: { x: number; y: number; zoom: number }) => void
}

function isMacLikePlatform(): boolean {
  if (typeof navigator === 'undefined') {
    return false
  }

  const navigatorWithUserAgentData = navigator as Navigator & {
    userAgentData?: { platform?: string }
  }
  const platform =
    (typeof navigatorWithUserAgentData.userAgentData?.platform === 'string' &&
      navigatorWithUserAgentData.userAgentData.platform) ||
    navigator.platform ||
    ''

  return platform.toLowerCase().includes('mac')
}

function resolveWheelZoomDelta(event: WheelEvent): number {
  const sample: WheelInputSample = {
    deltaX: event.deltaX,
    deltaY: event.deltaY,
    deltaMode: event.deltaMode,
    altKey: event.altKey,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    shiftKey: event.shiftKey,
    timeStamp: Number.isFinite(event.timeStamp) && event.timeStamp >= 0 ? event.timeStamp : 0,
  }
  const factor = isMacLikePlatform() && isPinchLikeZoomWheelSample(sample) ? 10 : 1
  return -event.deltaY * (event.deltaMode === 1 ? 0.05 : event.deltaMode ? 1 : 0.002) * factor
}

function resolveEffectiveWheelZoomModifierKey(
  setting: CanvasWheelZoomModifier,
  platform: string | undefined,
): 'ctrl' | 'meta' | 'alt' {
  switch (setting) {
    case 'primary':
      return platform === 'darwin' ? 'meta' : 'ctrl'
    case 'ctrl':
      return 'ctrl'
    case 'alt':
      return 'alt'
  }
}

export function useWorkspaceCanvasTrackpadGestures({
  canvasInputModeSetting,
  canvasWheelBehaviorSetting,
  canvasWheelZoomModifierSetting,
  resolvedCanvasInputMode,
  inputModalityStateRef,
  setDetectedCanvasInputMode,
  canvasRef,
  trackpadGestureLockRef,
  viewportRef,
  reactFlow,
  onViewportChange,
}: UseTrackpadGesturesParams): { handleCanvasWheelCapture: (event: WheelEvent) => void } {
  const reactFlowStore = useStoreApi()
  const interactionClearTimerRef = useRef<number | null>(null)
  const viewportCommitTimerRef = useRef<number | null>(null)
  const safariPinchSessionRef = useRef<{
    startScale: number
    anchorFlow: { x: number; y: number }
    startViewport: Viewport
  } | null>(null)

  const markViewportInteractionActive = useCallback(() => {
    reactFlowStore.setState({
      coveViewportInteractionActive: true,
    } as unknown as Parameters<typeof reactFlowStore.setState>[0])

    if (interactionClearTimerRef.current !== null) {
      window.clearTimeout(interactionClearTimerRef.current)
    }

    interactionClearTimerRef.current = window.setTimeout(() => {
      interactionClearTimerRef.current = null
      reactFlowStore.setState({
        coveViewportInteractionActive: false,
      } as unknown as Parameters<typeof reactFlowStore.setState>[0])
    }, 120)
  }, [reactFlowStore])

  const handleCanvasWheelCapture = useCallback(
    (event: WheelEvent) => {
      const platform =
        typeof window !== 'undefined' && window.opencoveApi?.meta?.platform
          ? window.opencoveApi.meta.platform
          : undefined
      const effectiveWheelZoomModifierKey = resolveEffectiveWheelZoomModifierKey(
        canvasWheelZoomModifierSetting,
        platform,
      )
      const wheelTarget = resolveWheelTarget(event.target)
      const canvasElement = canvasRef.current
      const isTargetWithinCanvas =
        canvasElement !== null &&
        event.target instanceof Node &&
        canvasElement.contains(event.target)
      const lockTimestamp =
        Number.isFinite(event.timeStamp) && event.timeStamp > 0
          ? event.timeStamp
          : performance.now()

      const decision = resolveCanvasWheelGesture({
        canvasInputModeSetting,
        canvasWheelBehaviorSetting,
        resolvedCanvasInputMode,
        inputModalityState: inputModalityStateRef.current,
        trackpadGestureLock: trackpadGestureLockRef.current,
        wheelTarget,
        isTargetWithinCanvas,
        wheelZoomModifierKey: effectiveWheelZoomModifierKey,
        sample: {
          deltaX: event.deltaX,
          deltaY: event.deltaY,
          deltaMode: event.deltaMode,
          altKey: event.altKey,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          shiftKey: event.shiftKey,
          timeStamp: event.timeStamp,
        },
        lockTimestamp,
      })

      inputModalityStateRef.current = decision.nextInputModalityState
      setDetectedCanvasInputMode(previous =>
        previous === decision.nextDetectedCanvasInputMode
          ? previous
          : decision.nextDetectedCanvasInputMode,
      )
      trackpadGestureLockRef.current = decision.nextTrackpadGestureLock

      if (decision.canvasAction === null) {
        return
      }

      markViewportInteractionActive()

      event.preventDefault()
      event.stopPropagation()

      const currentViewport = viewportRef.current

      if (viewportCommitTimerRef.current !== null) {
        window.clearTimeout(viewportCommitTimerRef.current)
      }

      if (decision.canvasAction === 'pan') {
        const deltaNormalize = event.deltaMode === 1 ? 20 : 1
        let deltaX = event.deltaX * deltaNormalize
        let deltaY = event.deltaY * deltaNormalize

        if (!isMacLikePlatform() && event.shiftKey) {
          deltaX = event.deltaY * deltaNormalize
          deltaY = 0
        }

        const nextViewport = {
          x: currentViewport.x - (deltaX / currentViewport.zoom) * TRACKPAD_PAN_SCROLL_SPEED,
          y: currentViewport.y - (deltaY / currentViewport.zoom) * TRACKPAD_PAN_SCROLL_SPEED,
          zoom: currentViewport.zoom,
        }

        viewportRef.current = nextViewport
        reactFlow.setViewport(nextViewport, { duration: 0 })
        viewportCommitTimerRef.current = window.setTimeout(() => {
          viewportCommitTimerRef.current = null
          onViewportChange(viewportRef.current)
        }, 120)
        return
      }

      const nextZoom = clampNumber(
        currentViewport.zoom * Math.pow(2, resolveWheelZoomDelta(event)),
        MIN_CANVAS_ZOOM,
        MAX_CANVAS_ZOOM,
      )

      if (Math.abs(nextZoom - currentViewport.zoom) < 0.0001) {
        return
      }

      const canvasRect = canvasRef.current?.getBoundingClientRect()
      const anchorLocalX =
        canvasRect && Number.isFinite(canvasRect.left)
          ? event.clientX - canvasRect.left
          : event.clientX
      const anchorLocalY =
        canvasRect && Number.isFinite(canvasRect.top)
          ? event.clientY - canvasRect.top
          : event.clientY

      const anchorFlow = reactFlow.screenToFlowPosition
        ? reactFlow.screenToFlowPosition({ x: event.clientX, y: event.clientY })
        : {
            x: (anchorLocalX - currentViewport.x) / currentViewport.zoom,
            y: (anchorLocalY - currentViewport.y) / currentViewport.zoom,
          }

      const nextViewport = {
        x: anchorLocalX - anchorFlow.x * nextZoom,
        y: anchorLocalY - anchorFlow.y * nextZoom,
        zoom: nextZoom,
      }

      viewportRef.current = nextViewport
      reactFlow.setViewport(nextViewport, { duration: 0 })
      viewportCommitTimerRef.current = window.setTimeout(() => {
        viewportCommitTimerRef.current = null
        onViewportChange(viewportRef.current)
      }, 120)
    },
    [
      canvasInputModeSetting,
      canvasWheelBehaviorSetting,
      canvasWheelZoomModifierSetting,
      canvasRef,
      inputModalityStateRef,
      markViewportInteractionActive,
      onViewportChange,
      reactFlow,
      resolvedCanvasInputMode,
      setDetectedCanvasInputMode,
      trackpadGestureLockRef,
      viewportRef,
    ],
  )

  useEffect(() => {
    return () => {
      if (interactionClearTimerRef.current !== null) {
        window.clearTimeout(interactionClearTimerRef.current)
        interactionClearTimerRef.current = null
      }

      if (viewportCommitTimerRef.current !== null) {
        window.clearTimeout(viewportCommitTimerRef.current)
        viewportCommitTimerRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    const useManualCanvasWheelGestures =
      canvasInputModeSetting !== 'mouse' || canvasWheelBehaviorSetting === 'pan'
    if (!useManualCanvasWheelGestures) {
      return
    }

    const canvasElement = canvasRef.current
    if (!canvasElement) {
      return
    }

    type SafariGestureEvent = Event & {
      scale?: number
      clientX?: number
      clientY?: number
    }

    const resolveAnchorLocal = (
      event: SafariGestureEvent,
      canvasRect: DOMRect | null,
    ): { x: number; y: number } => {
      const clientX = Number.isFinite(event.clientX) ? Number(event.clientX) : 0
      const clientY = Number.isFinite(event.clientY) ? Number(event.clientY) : 0

      const x = canvasRect && Number.isFinite(canvasRect.left) ? clientX - canvasRect.left : clientX
      const y = canvasRect && Number.isFinite(canvasRect.top) ? clientY - canvasRect.top : clientY

      return { x, y }
    }

    const resolveAnchorFlow = (
      anchorLocal: { x: number; y: number },
      clientPoint: { x: number; y: number },
      viewport: Viewport,
    ): { x: number; y: number } => {
      if (reactFlow.screenToFlowPosition) {
        return reactFlow.screenToFlowPosition({ x: clientPoint.x, y: clientPoint.y })
      }

      return {
        x: (anchorLocal.x - viewport.x) / viewport.zoom,
        y: (anchorLocal.y - viewport.y) / viewport.zoom,
      }
    }

    const commitViewportSoon = (): void => {
      if (viewportCommitTimerRef.current !== null) {
        window.clearTimeout(viewportCommitTimerRef.current)
      }

      viewportCommitTimerRef.current = window.setTimeout(() => {
        viewportCommitTimerRef.current = null
        onViewportChange(viewportRef.current)
      }, 120)
    }

    const handleGestureStart = (rawEvent: Event): void => {
      const event = rawEvent as SafariGestureEvent

      const lockTimestamp =
        Number.isFinite(event.timeStamp) && event.timeStamp > 0
          ? event.timeStamp
          : performance.now()
      inputModalityStateRef.current = {
        ...inputModalityStateRef.current,
        mode: 'trackpad',
        lastEventTimestamp: lockTimestamp,
        burstEventCount: 0,
        gestureLikeEventCount: 0,
        burstMode: 'trackpad',
      }
      setDetectedCanvasInputMode(previous => (previous === 'trackpad' ? previous : 'trackpad'))
      trackpadGestureLockRef.current = {
        action: 'pinch',
        target: 'canvas',
        lastTimestamp: lockTimestamp,
      }

      markViewportInteractionActive()

      const canvasRect = canvasElement.getBoundingClientRect()
      const anchorLocal = resolveAnchorLocal(event, canvasRect)
      const clientX = Number.isFinite(event.clientX) ? Number(event.clientX) : 0
      const clientY = Number.isFinite(event.clientY) ? Number(event.clientY) : 0

      const startViewport = viewportRef.current
      safariPinchSessionRef.current = {
        startScale:
          typeof event.scale === 'number' && Number.isFinite(event.scale) && event.scale > 0
            ? event.scale
            : 1,
        anchorFlow: resolveAnchorFlow(anchorLocal, { x: clientX, y: clientY }, startViewport),
        startViewport,
      }

      event.preventDefault()
      event.stopPropagation()
    }

    const handleGestureChange = (rawEvent: Event): void => {
      const event = rawEvent as SafariGestureEvent
      const session = safariPinchSessionRef.current
      if (!session) {
        return
      }

      const scale =
        typeof event.scale === 'number' && Number.isFinite(event.scale) && event.scale > 0
          ? event.scale
          : 1
      const nextZoom = clampNumber(
        session.startViewport.zoom * (scale / session.startScale),
        MIN_CANVAS_ZOOM,
        MAX_CANVAS_ZOOM,
      )

      if (Math.abs(nextZoom - viewportRef.current.zoom) < 0.0001) {
        event.preventDefault()
        event.stopPropagation()
        return
      }

      markViewportInteractionActive()

      const canvasRect = canvasElement.getBoundingClientRect()
      const anchorLocal = resolveAnchorLocal(event, canvasRect)

      const nextViewport = {
        x: anchorLocal.x - session.anchorFlow.x * nextZoom,
        y: anchorLocal.y - session.anchorFlow.y * nextZoom,
        zoom: nextZoom,
      }

      viewportRef.current = nextViewport
      reactFlow.setViewport(nextViewport, { duration: 0 })
      commitViewportSoon()

      event.preventDefault()
      event.stopPropagation()
    }

    const handleGestureEnd = (rawEvent: Event): void => {
      const event = rawEvent as SafariGestureEvent
      safariPinchSessionRef.current = null
      commitViewportSoon()

      event.preventDefault()
      event.stopPropagation()
    }

    const gestureListenerOptions = { passive: false, capture: true } as const

    canvasElement.addEventListener('gesturestart', handleGestureStart, gestureListenerOptions)
    canvasElement.addEventListener('gesturechange', handleGestureChange, gestureListenerOptions)
    canvasElement.addEventListener('gestureend', handleGestureEnd, gestureListenerOptions)

    return () => {
      safariPinchSessionRef.current = null
      canvasElement.removeEventListener('gesturestart', handleGestureStart, true)
      canvasElement.removeEventListener('gesturechange', handleGestureChange, true)
      canvasElement.removeEventListener('gestureend', handleGestureEnd, true)
    }
  }, [
    canvasInputModeSetting,
    canvasWheelBehaviorSetting,
    canvasRef,
    inputModalityStateRef,
    markViewportInteractionActive,
    onViewportChange,
    reactFlow,
    setDetectedCanvasInputMode,
    trackpadGestureLockRef,
    viewportRef,
  ])

  return { handleCanvasWheelCapture }
}
