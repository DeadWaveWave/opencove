import type { CanvasWheelZoomModifier } from '@contexts/settings/domain/agentSettings'
import { isPinchLikeZoomWheelSample, type WheelInputSample } from '../../../utils/inputModality'
import type { TrackpadGestureLockState } from '../types'

export function isMacLikePlatform(): boolean {
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

export function resolveWheelZoomDelta(event: WheelEvent): number {
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

export function resolveEffectiveWheelZoomModifierKey(
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

export function resolveCanvasWheelGestureCaptureActive(
  session: TrackpadGestureLockState | null,
): boolean {
  return session?.owner === 'canvas' && session.phase === 'active'
}

export function resolveTrackpadGestureSessionAfterGap(
  session: TrackpadGestureLockState | null,
): TrackpadGestureLockState | null {
  if (session === null || session.owner !== 'canvas' || session.phase !== 'active') {
    return null
  }

  return {
    ...session,
    phase: 'settling',
  }
}

export function shouldClearSettledCanvasWheelSessionForPointerIntent(
  session: TrackpadGestureLockState | null,
): boolean {
  return session?.owner === 'canvas' && session.phase === 'settling'
}
