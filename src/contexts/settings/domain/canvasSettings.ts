export const CANVAS_INPUT_MODES = ['auto', 'mouse', 'trackpad'] as const
export type CanvasInputMode = (typeof CANVAS_INPUT_MODES)[number]

export const CANVAS_WHEEL_BEHAVIORS = ['zoom', 'pan'] as const
export type CanvasWheelBehavior = (typeof CANVAS_WHEEL_BEHAVIORS)[number]

export const CANVAS_WHEEL_ZOOM_MODIFIERS = ['primary', 'ctrl', 'alt'] as const
export type CanvasWheelZoomModifier = (typeof CANVAS_WHEEL_ZOOM_MODIFIERS)[number]

export const STANDARD_WINDOW_SIZE_BUCKETS = ['compact', 'regular', 'large'] as const
export type StandardWindowSizeBucket = (typeof STANDARD_WINDOW_SIZE_BUCKETS)[number]

export function isValidCanvasInputMode(value: unknown): value is CanvasInputMode {
  return typeof value === 'string' && CANVAS_INPUT_MODES.includes(value as CanvasInputMode)
}

export function isValidCanvasWheelBehavior(value: unknown): value is CanvasWheelBehavior {
  return typeof value === 'string' && CANVAS_WHEEL_BEHAVIORS.includes(value as CanvasWheelBehavior)
}

export function isValidCanvasWheelZoomModifier(value: unknown): value is CanvasWheelZoomModifier {
  return (
    typeof value === 'string' &&
    CANVAS_WHEEL_ZOOM_MODIFIERS.includes(value as CanvasWheelZoomModifier)
  )
}

export function isValidStandardWindowSizeBucket(value: unknown): value is StandardWindowSizeBucket {
  return (
    typeof value === 'string' &&
    STANDARD_WINDOW_SIZE_BUCKETS.includes(value as StandardWindowSizeBucket)
  )
}
