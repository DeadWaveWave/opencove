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

function isTestEnvironment(): boolean {
  return typeof window !== 'undefined' && window.opencoveApi?.meta?.isTest === true
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
  const pendingViewportCommitRef = useRef<Viewport | null>(null)
  const pendingPanPixelDeltaRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const pendingPanFrameRef = useRef<number | null>(null)

  const flushPendingPan = useCallback(
    ({ applyToReactFlow }: { applyToReactFlow: boolean }): void => {
      if (pendingPanFrameRef.current !== null) {
        window.cancelAnimationFrame(pendingPanFrameRef.current)
        pendingPanFrameRef.current = null
      }

      const pendingDelta = pendingPanPixelDeltaRef.current
      if (pendingDelta.x === 0 && pendingDelta.y === 0) {
        return
      }

      pendingPanPixelDeltaRef.current = { x: 0, y: 0 }

      const viewport = viewportRef.current
      const nextViewport = {
        x: viewport.x - (pendingDelta.x / viewport.zoom) * TRACKPAD_PAN_SCROLL_SPEED,
        y: viewport.y - (pendingDelta.y / viewport.zoom) * TRACKPAD_PAN_SCROLL_SPEED,
        zoom: viewport.zoom,
      }

      viewportRef.current = nextViewport
      if (applyToReactFlow) {
        reactFlow.setViewport(nextViewport, { duration: 0 })
      }
      pendingViewportCommitRef.current = nextViewport
    },
    [reactFlow, viewportRef],
  )

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

        flushPendingPan({ applyToReactFlow: true })

        const pendingViewport = pendingViewportCommitRef.current
        if (pendingViewport !== null) {
          pendingViewportCommitRef.current = null
          onViewportChange({
            x: pendingViewport.x,
            y: pendingViewport.y,
            zoom: pendingViewport.zoom,
          })
        }
      }, 120)

      event.preventDefault()
      event.stopPropagation()

      const currentViewport = viewportRef.current

      if (decision.canvasAction === 'pan') {
        const deltaNormalize = event.deltaMode === 1 ? 20 : 1
        let deltaX = event.deltaX * deltaNormalize
        let deltaY = event.deltaY * deltaNormalize

        if (!isMacLikePlatform() && event.shiftKey) {
          deltaX = event.deltaY * deltaNormalize
          deltaY = 0
        }

        if (isTestEnvironment()) {
          const nextViewport = {
            x: currentViewport.x - (deltaX / currentViewport.zoom) * TRACKPAD_PAN_SCROLL_SPEED,
            y: currentViewport.y - (deltaY / currentViewport.zoom) * TRACKPAD_PAN_SCROLL_SPEED,
            zoom: currentViewport.zoom,
          }

          viewportRef.current = nextViewport
          reactFlow.setViewport(nextViewport, { duration: 0 })
          pendingViewportCommitRef.current = nextViewport
          return
        }

        pendingPanPixelDeltaRef.current.x += deltaX
        pendingPanPixelDeltaRef.current.y += deltaY

        if (pendingPanFrameRef.current === null) {
          pendingPanFrameRef.current = window.requestAnimationFrame(() => {
            pendingPanFrameRef.current = null
            flushPendingPan({ applyToReactFlow: true })
          })
        }

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

      const anchorFlow = {
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
      pendingViewportCommitRef.current = nextViewport
    },
    [
      canvasInputModeSetting,
      canvasWheelBehaviorSetting,
      canvasWheelZoomModifierSetting,
      canvasRef,
      inputModalityStateRef,
      flushPendingPan,
      onViewportChange,
      reactFlowStore,
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

      flushPendingPan({ applyToReactFlow: false })

      const pendingViewport = pendingViewportCommitRef.current
      if (pendingViewport !== null) {
        pendingViewportCommitRef.current = null
        onViewportChange({
          x: pendingViewport.x,
          y: pendingViewport.y,
          zoom: pendingViewport.zoom,
        })
      }
    }
  }, [flushPendingPan, onViewportChange])

  return { handleCanvasWheelCapture }
}
