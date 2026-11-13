/**
 * What the canvas draws behind windows (Tide): the pixel wall, the quiet neutral dot grid with
 * event ripples (「简约」), or the plain dot grid with no canvas effects (「关闭」).
 */
export const CANVAS_BACKGROUND_STYLES = ['pixel', 'minimal', 'off'] as const
export type CanvasBackgroundStyle = (typeof CANVAS_BACKGROUND_STYLES)[number]

export function isCanvasBackgroundStyle(value: unknown): value is CanvasBackgroundStyle {
  return (
    typeof value === 'string' && (CANVAS_BACKGROUND_STYLES as readonly string[]).includes(value)
  )
}

// @compat settings-legacy-fields
/**
 * The style replaces the `canvasPixelBackgroundEnabled` switch: on became the pixel wall, off
 * became 「关闭」, which keeps the dot grid that switch showed.
 */
export function normalizeCanvasBackgroundStyle(
  value: unknown,
  legacyEnabled: boolean | null,
  fallback: CanvasBackgroundStyle,
): CanvasBackgroundStyle {
  if (isCanvasBackgroundStyle(value)) {
    return value
  }
  if (legacyEnabled !== null) {
    return legacyEnabled ? 'pixel' : 'off'
  }
  return fallback
}
