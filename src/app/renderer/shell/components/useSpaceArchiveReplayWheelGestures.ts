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
  isPinchLikeZoomWheelSample,
  type DetectedCanvasInputMode,
  type WheelInputSample,
} from '@contexts/workspace/presentation/renderer/utils/inputModality'
import type {
  CanvasWheelBehavior,
  CanvasWheelZoomModifier,
} from '@contexts/settings/domain/agentSettings'
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

export function useSpaceArchiveReplayWheelGestures({
  canvasInputModeSetting,
  canvasWheelBehaviorSetting,
  canvasWheelZoomModifierSetting,
  canvasRef,
  reactFlowInstanceRef,
  viewportRef,
}: {
  canvasInputModeSetting: 'mouse' | 'trackpad' | 'auto'
  canvasWheelBehaviorSetting: CanvasWheelBehavior
  canvasWheelZoomModifierSetting: CanvasWheelZoomModifier
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
  const useManualCanvasWheelGestures =
    canvasInputModeSetting !== 'mouse' || canvasWheelBehaviorSetting === 'pan'

  const handleWheelCapture = React.useCallback(
    (event: WheelEvent) => {
      if (!useManualCanvasWheelGestures) {
        return
      }

      const platform =
        typeof window !== 'undefined' && window.opencoveApi?.meta?.platform
          ? window.opencoveApi.meta.platform
          : undefined
      const effectiveWheelZoomModifierKey = resolveEffectiveWheelZoomModifierKey(
        canvasWheelZoomModifierSetting,
        platform,
      )
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
      canvasWheelBehaviorSetting,
      canvasWheelZoomModifierSetting,
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
