export const MIN_FOCUS_NODE_TARGET_ZOOM = 0.1
export const MAX_FOCUS_NODE_TARGET_ZOOM = 2
export const FOCUS_NODE_TARGET_ZOOM_STEP = 0.01

export type FocusNodeTargetZoom = number

export function normalizeFocusNodeTargetZoom(
  value: unknown,
  fallback: FocusNodeTargetZoom,
): FocusNodeTargetZoom {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback
  }

  const clamped = Math.max(MIN_FOCUS_NODE_TARGET_ZOOM, Math.min(MAX_FOCUS_NODE_TARGET_ZOOM, value))
  // Keep persisted values stable and avoid float noise.
  const normalized = Math.round(clamped / FOCUS_NODE_TARGET_ZOOM_STEP) * FOCUS_NODE_TARGET_ZOOM_STEP
  return Number(normalized.toFixed(2))
}
