import {
  classifyCurrentWheelInputMode,
  inferCanvasInputModalityFromWheel,
  isPinchLikeZoomWheelSample,
  type CanvasInputModalityState,
  type DetectedCanvasInputMode,
  type WheelInputSample,
} from '../../utils/inputModality'
import { TRACKPAD_GESTURE_LOCK_GAP_MS } from './constants'
import type {
  TrackpadGestureAction,
  TrackpadGestureLockState,
  TrackpadGestureTarget,
} from './types'

export interface ResolveCanvasWheelGestureParams {
  canvasInputModeSetting: 'mouse' | 'trackpad' | 'auto'
  canvasWheelBehaviorSetting: 'zoom' | 'pan'
  resolvedCanvasInputMode: DetectedCanvasInputMode
  inputModalityState: CanvasInputModalityState
  trackpadGestureLock: TrackpadGestureLockState | null
  wheelTarget: TrackpadGestureTarget
  isTargetWithinCanvas: boolean
  wheelZoomModifierKey: 'ctrl' | 'meta' | 'alt'
  sample: WheelInputSample
  lockTimestamp: number
}

export interface CanvasWheelGestureDecision {
  canvasAction: 'pan' | 'zoom' | null
  nextDetectedCanvasInputMode: DetectedCanvasInputMode
  nextInputModalityState: CanvasInputModalityState
  nextTrackpadGestureLock: TrackpadGestureLockState | null
}

function resolveActiveGestureLock(
  trackpadGestureLock: TrackpadGestureLockState | null,
  lockTimestamp: number,
): TrackpadGestureLockState | null {
  if (
    trackpadGestureLock === null ||
    lockTimestamp - trackpadGestureLock.lastTimestamp > TRACKPAD_GESTURE_LOCK_GAP_MS
  ) {
    return null
  }

  return trackpadGestureLock
}

function resolveFixedModeDecision(
  canvasInputModeSetting: 'mouse' | 'trackpad',
  inputModalityState: CanvasInputModalityState,
): Pick<
  CanvasWheelGestureDecision,
  'nextDetectedCanvasInputMode' | 'nextInputModalityState' | 'nextTrackpadGestureLock'
> {
  return {
    nextDetectedCanvasInputMode: canvasInputModeSetting,
    nextInputModalityState: inputModalityState,
    nextTrackpadGestureLock: null,
  }
}

export function resolveCanvasWheelGesture({
  canvasInputModeSetting,
  canvasWheelBehaviorSetting,
  resolvedCanvasInputMode,
  inputModalityState,
  trackpadGestureLock,
  wheelTarget,
  isTargetWithinCanvas,
  wheelZoomModifierKey,
  sample,
  lockTimestamp,
}: ResolveCanvasWheelGestureParams): CanvasWheelGestureDecision {
  const activeLock = resolveActiveGestureLock(trackpadGestureLock, lockTimestamp)
  const isCanvasSurfaceEvent = isTargetWithinCanvas && wheelTarget === 'canvas'
  const isPinchZoom = isPinchLikeZoomWheelSample(sample)
  const isZoomModifierPressed =
    wheelZoomModifierKey === 'ctrl'
      ? sample.ctrlKey
      : wheelZoomModifierKey === 'meta'
        ? sample.metaKey
        : sample.altKey

  if (canvasInputModeSetting === 'mouse') {
    const fixedModeDecision = resolveFixedModeDecision(canvasInputModeSetting, inputModalityState)

    return {
      canvasAction:
        canvasWheelBehaviorSetting === 'pan' && isCanvasSurfaceEvent
          ? isPinchZoom || isZoomModifierPressed
            ? 'zoom'
            : 'pan'
          : null,
      ...fixedModeDecision,
    }
  }

  let nextInputModalityState = inputModalityState
  let nextDetectedCanvasInputMode: DetectedCanvasInputMode =
    canvasInputModeSetting === 'trackpad' ? 'trackpad' : resolvedCanvasInputMode

  let eventMode: DetectedCanvasInputMode = nextDetectedCanvasInputMode

  if (canvasInputModeSetting === 'auto') {
    const classifiedEventMode = classifyCurrentWheelInputMode(inputModalityState, sample)

    if (isCanvasSurfaceEvent || sample.ctrlKey) {
      nextInputModalityState = inferCanvasInputModalityFromWheel(inputModalityState, sample)
      eventMode =
        classifiedEventMode === 'unknown' ? nextInputModalityState.mode : classifiedEventMode
      nextDetectedCanvasInputMode = eventMode
    } else {
      eventMode = classifiedEventMode === 'unknown' ? resolvedCanvasInputMode : classifiedEventMode
      nextDetectedCanvasInputMode = resolvedCanvasInputMode
    }
  }

  if (eventMode === 'mouse') {
    return {
      canvasAction: isCanvasSurfaceEvent
        ? canvasWheelBehaviorSetting === 'pan'
          ? isPinchZoom || isZoomModifierPressed
            ? 'zoom'
            : 'pan'
          : 'zoom'
        : null,
      nextDetectedCanvasInputMode,
      nextInputModalityState,
      nextTrackpadGestureLock: null,
    }
  }

  const action: TrackpadGestureAction =
    canvasWheelBehaviorSetting === 'pan'
      ? isPinchZoom || isZoomModifierPressed
        ? 'pinch'
        : 'pan'
      : isPinchZoom
        ? 'pinch'
        : 'pan'
  const canContinueCanvasLock =
    activeLock !== null && activeLock.action === action && activeLock.target === 'canvas'

  if (!isTargetWithinCanvas && !canContinueCanvasLock) {
    return {
      canvasAction: null,
      nextDetectedCanvasInputMode,
      nextInputModalityState,
      nextTrackpadGestureLock: null,
    }
  }

  if (!isCanvasSurfaceEvent && !canContinueCanvasLock) {
    return {
      canvasAction: null,
      nextDetectedCanvasInputMode,
      nextInputModalityState,
      nextTrackpadGestureLock: {
        action,
        target: wheelTarget,
        lastTimestamp: lockTimestamp,
      },
    }
  }

  const lockedTarget =
    activeLock !== null && activeLock.action === action ? activeLock.target : 'canvas'
  const nextTrackpadGestureLock: TrackpadGestureLockState = {
    action,
    target: lockedTarget,
    lastTimestamp: lockTimestamp,
  }

  return {
    canvasAction: lockedTarget === 'canvas' ? (action === 'pan' ? 'pan' : 'zoom') : null,
    nextDetectedCanvasInputMode,
    nextInputModalityState,
    nextTrackpadGestureLock,
  }
}
