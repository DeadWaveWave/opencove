export type DetectedCanvasInputMode = 'mouse' | 'trackpad'
export type ClassifiedWheelInputMode = DetectedCanvasInputMode | 'unknown'

export interface CanvasInputModalityState {
  mode: DetectedCanvasInputMode
  lastEventTimestamp: number | null
  burstEventCount: number
  gestureLikeEventCount: number
  burstMode: ClassifiedWheelInputMode
}

export interface WheelInputSample {
  deltaX: number
  deltaY: number
  deltaMode: number
  ctrlKey: boolean
  timeStamp: number
}

interface WheelAxisMetrics {
  absX: number
  absY: number
  dominant: number
  secondary: number
}

const TRACKPAD_BURST_GAP_MS = 220
const TRACKPAD_BURST_SWITCH_EVENT_COUNT = 2
const LARGE_SINGLE_AXIS_MOUSE_BURST = 64
const STRONG_TRACKPAD_PIXEL_DELTA_MAX = 18
const MOUSE_SINGLE_AXIS_DELTA_MIN = 24

function hasFractionalDelta(value: number): boolean {
  if (!Number.isFinite(value)) {
    return false
  }

  return Math.abs(value - Math.trunc(value)) > 0.001
}

function isDiscreteWheelStep(value: number): boolean {
  const absolute = Math.abs(value)
  if (absolute < MOUSE_SINGLE_AXIS_DELTA_MIN) {
    return false
  }

  const nearestInteger = Math.round(absolute)
  if (Math.abs(absolute - nearestInteger) > 0.001) {
    return false
  }

  return (
    nearestInteger % 40 === 0 ||
    nearestInteger % 50 === 0 ||
    nearestInteger % 60 === 0 ||
    nearestInteger % 100 === 0 ||
    nearestInteger % 120 === 0
  )
}

function normalizeTimestamp(value: number, fallback: number | null): number {
  if (Number.isFinite(value) && value >= 0) {
    return value
  }

  return fallback ?? 0
}

function resolveWheelAxisMetrics(sample: WheelInputSample): WheelAxisMetrics {
  const absX = Math.abs(sample.deltaX)
  const absY = Math.abs(sample.deltaY)

  return {
    absX,
    absY,
    dominant: Math.max(absX, absY),
    secondary: Math.min(absX, absY),
  }
}

function isSecondaryAxisNoise(metrics: WheelAxisMetrics): boolean {
  if (metrics.dominant <= 0) {
    return true
  }

  return metrics.secondary <= Math.max(1.5, metrics.dominant * 0.12)
}

function hasMeaningfulDualAxisGesture(metrics: WheelAxisMetrics): boolean {
  if (metrics.dominant < 0.01 || metrics.secondary < 0.8) {
    return false
  }

  return metrics.secondary / metrics.dominant >= 0.2
}

function isSingleAxisMouseWheelLikeGesture(metrics: WheelAxisMetrics): boolean {
  return metrics.dominant >= MOUSE_SINGLE_AXIS_DELTA_MIN && isSecondaryAxisNoise(metrics)
}

function isSingleAxisDiscreteWheelStep(metrics: WheelAxisMetrics): boolean {
  return isSingleAxisMouseWheelLikeGesture(metrics) && isDiscreteWheelStep(metrics.dominant)
}

function isLargeSingleAxisMouseBurst(metrics: WheelAxisMetrics): boolean {
  return (
    isSingleAxisMouseWheelLikeGesture(metrics) && metrics.dominant >= LARGE_SINGLE_AXIS_MOUSE_BURST
  )
}

function isHighConfidenceMouseWheelSample(sample: WheelInputSample): boolean {
  if (sample.deltaMode === 1 || sample.deltaMode === 2) {
    return true
  }

  const metrics = resolveWheelAxisMetrics(sample)

  return isSingleAxisDiscreteWheelStep(metrics) || isLargeSingleAxisMouseBurst(metrics)
}

function isStrongTrackpadPanSample(sample: WheelInputSample): boolean {
  if (sample.ctrlKey || sample.deltaMode !== 0 || isHighConfidenceMouseWheelSample(sample)) {
    return false
  }

  const metrics = resolveWheelAxisMetrics(sample)

  if (!hasMeaningfulDualAxisGesture(metrics)) {
    return false
  }

  return (
    metrics.dominant <= STRONG_TRACKPAD_PIXEL_DELTA_MAX ||
    hasFractionalDelta(metrics.absX) ||
    hasFractionalDelta(metrics.absY)
  )
}

function isCandidateTrackpadPanSample(sample: WheelInputSample): boolean {
  if (sample.ctrlKey || sample.deltaMode !== 0 || isHighConfidenceMouseWheelSample(sample)) {
    return false
  }

  const metrics = resolveWheelAxisMetrics(sample)
  return hasMeaningfulDualAxisGesture(metrics)
}

function resolveWheelSampleTiming(
  previous: CanvasInputModalityState,
  sample: WheelInputSample,
): { timestamp: number; intervalMs: number | null; continuesBurst: boolean } {
  const timestamp = normalizeTimestamp(sample.timeStamp, previous.lastEventTimestamp)
  const intervalMs =
    previous.lastEventTimestamp === null || timestamp < previous.lastEventTimestamp
      ? null
      : timestamp - previous.lastEventTimestamp

  return {
    timestamp,
    intervalMs,
    continuesBurst: intervalMs !== null && intervalMs >= 0 && intervalMs <= TRACKPAD_BURST_GAP_MS,
  }
}

export function createCanvasInputModalityState(
  initialMode: DetectedCanvasInputMode = 'mouse',
): CanvasInputModalityState {
  return {
    mode: initialMode,
    lastEventTimestamp: null,
    burstEventCount: 0,
    gestureLikeEventCount: 0,
    burstMode: 'unknown',
  }
}

export function classifyCurrentWheelInputMode(
  previous: CanvasInputModalityState,
  sample: WheelInputSample,
): ClassifiedWheelInputMode {
  const { continuesBurst } = resolveWheelSampleTiming(previous, sample)

  if (sample.ctrlKey) {
    return 'trackpad'
  }

  if (isHighConfidenceMouseWheelSample(sample)) {
    return 'mouse'
  }

  if (isStrongTrackpadPanSample(sample)) {
    return 'trackpad'
  }

  if (continuesBurst) {
    if (previous.burstMode === 'mouse') {
      return 'mouse'
    }

    if (previous.burstMode === 'trackpad') {
      return 'trackpad'
    }
  }

  if (isCandidateTrackpadPanSample(sample)) {
    const nextGestureLikeEventCount = continuesBurst ? previous.gestureLikeEventCount + 1 : 1

    if (nextGestureLikeEventCount >= TRACKPAD_BURST_SWITCH_EVENT_COUNT) {
      return 'trackpad'
    }
  }

  return 'unknown'
}

export function inferCanvasInputModalityFromWheel(
  previous: CanvasInputModalityState,
  sample: WheelInputSample,
): CanvasInputModalityState {
  const { timestamp, continuesBurst } = resolveWheelSampleTiming(previous, sample)
  const classifiedMode = classifyCurrentWheelInputMode(previous, sample)
  const isGestureLikeSample = sample.ctrlKey || isCandidateTrackpadPanSample(sample)

  let nextBurstEventCount = continuesBurst ? previous.burstEventCount + 1 : 1
  let nextGestureLikeEventCount = continuesBurst ? previous.gestureLikeEventCount : 0

  if (isGestureLikeSample) {
    nextGestureLikeEventCount = continuesBurst ? previous.gestureLikeEventCount + 1 : 1
  } else if (!continuesBurst || classifiedMode === 'mouse') {
    nextGestureLikeEventCount = 0
  }

  let nextBurstMode = classifiedMode

  if (classifiedMode === 'unknown' && continuesBurst) {
    nextBurstMode = previous.burstMode
  }

  if (!continuesBurst) {
    nextBurstEventCount = 1
    if (!isGestureLikeSample && classifiedMode !== 'trackpad') {
      nextGestureLikeEventCount = 0
    }
  }

  let nextMode = previous.mode

  if (classifiedMode === 'mouse') {
    nextMode = 'mouse'
  } else if (classifiedMode === 'trackpad') {
    nextMode = 'trackpad'
  }

  return {
    mode: nextMode,
    lastEventTimestamp: timestamp,
    burstEventCount: nextBurstEventCount,
    gestureLikeEventCount: nextGestureLikeEventCount,
    burstMode: nextBurstMode,
  }
}
