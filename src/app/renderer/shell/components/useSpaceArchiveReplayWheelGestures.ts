import React from 'react'
import type { ReactFlowInstance, Viewport } from '@xyflow/react'
import {
  clampNumber,
  resolveWheelTarget,
} from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/helpers'
import {
  MAX_CANVAS_ZOOM,
  MIN_CANVAS_ZOOM,
  TRACKPAD_PAN_SCROLL_SPEED,
} from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/constants'
import { resolveCanvasWheelGesture } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/wheelGestures'
import type { TrackpadGestureLockState } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/types'
import {
  createCanvasInputModalityState,
  type DetectedCanvasInputMode,
} from '@contexts/workspace/presentation/renderer/utils/inputModality'
import type { SpaceArchiveReplayNode } from './SpaceArchiveReplayNodes'

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
  const factor = event.ctrlKey && isMacLikePlatform() ? 10 : 1
  return -event.deltaY * (event.deltaMode === 1 ? 0.05 : event.deltaMode ? 1 : 0.002) * factor
}

export function useSpaceArchiveReplayWheelGestures({
  canvasInputModeSetting,
  canvasRef,
  reactFlowInstanceRef,
  viewportRef,
}: {
  canvasInputModeSetting: 'mouse' | 'trackpad' | 'auto'
  canvasRef: React.MutableRefObject<HTMLDivElement | null>
  reactFlowInstanceRef: React.MutableRefObject<ReactFlowInstance<SpaceArchiveReplayNode> | null>
  viewportRef: React.MutableRefObject<Viewport>
}): {
  resolvedCanvasInputMode: DetectedCanvasInputMode
  useManualCanvasWheelGestures: boolean
  handleWheelCapture: (event: WheelEvent) => void
} {
  const inputModalityStateRef = React.useRef(createCanvasInputModalityState())
  const trackpadGestureLockRef = React.useRef<TrackpadGestureLockState | null>(null)
  const [detectedCanvasInputMode, setDetectedCanvasInputMode] =
    React.useState<DetectedCanvasInputMode>('mouse')

  const resolvedCanvasInputMode: DetectedCanvasInputMode =
    canvasInputModeSetting === 'auto'
      ? detectedCanvasInputMode
      : (canvasInputModeSetting as DetectedCanvasInputMode)
  const useManualCanvasWheelGestures = canvasInputModeSetting !== 'mouse'

  const handleWheelCapture = React.useCallback(
    (event: WheelEvent) => {
      if (!useManualCanvasWheelGestures) {
        return
      }

      const reactFlow = reactFlowInstanceRef.current
      const canvasElement = canvasRef.current

      if (!reactFlow || !canvasElement) {
        return
      }

      const wheelTarget = resolveWheelTarget(event.target)
      const isTargetWithinCanvas =
        canvasElement !== null &&
        event.target instanceof Node &&
        canvasElement.contains(event.target)
      const lockTimestamp =
        Number.isFinite(event.timeStamp) && event.timeStamp >= 0
          ? event.timeStamp
          : performance.now()

      const decision = resolveCanvasWheelGesture({
        canvasInputModeSetting,
        resolvedCanvasInputMode,
        inputModalityState: inputModalityStateRef.current,
        trackpadGestureLock: trackpadGestureLockRef.current,
        wheelTarget,
        isTargetWithinCanvas,
        sample: {
          deltaX: event.deltaX,
          deltaY: event.deltaY,
          deltaMode: event.deltaMode,
          ctrlKey: event.ctrlKey,
          timeStamp: event.timeStamp,
        },
        lockTimestamp,
      })

      inputModalityStateRef.current = decision.nextInputModalityState
      trackpadGestureLockRef.current = decision.nextTrackpadGestureLock

      if (canvasInputModeSetting === 'auto') {
        setDetectedCanvasInputMode(previous =>
          previous === decision.nextDetectedCanvasInputMode
            ? previous
            : decision.nextDetectedCanvasInputMode,
        )
      }

      if (decision.canvasAction === null) {
        return
      }

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

        const nextViewport = {
          x: currentViewport.x - (deltaX / currentViewport.zoom) * TRACKPAD_PAN_SCROLL_SPEED,
          y: currentViewport.y - (deltaY / currentViewport.zoom) * TRACKPAD_PAN_SCROLL_SPEED,
          zoom: currentViewport.zoom,
        }

        viewportRef.current = nextViewport
        reactFlow.setViewport(nextViewport, { duration: 0 })
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

      const canvasRect = canvasElement.getBoundingClientRect()
      const anchorLocalX = event.clientX - canvasRect.left
      const anchorLocalY = event.clientY - canvasRect.top

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
    },
    [
      canvasInputModeSetting,
      canvasRef,
      reactFlowInstanceRef,
      resolvedCanvasInputMode,
      useManualCanvasWheelGestures,
      viewportRef,
    ],
  )

  return {
    resolvedCanvasInputMode,
    useManualCanvasWheelGestures,
    handleWheelCapture,
  }
}
