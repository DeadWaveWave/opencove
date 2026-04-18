export interface SpaceExplorerPixelRect {
  x: number
  y: number
  width: number
  height: number
}

export interface SpaceExplorerPlacement {
  width: number
  height: number
  left: number
  top: number
  minWidth: number
  maxWidth: number
}

const EXPLORER_MIN_WIDTH_INSIDE = 160
const EXPLORER_MIN_HEIGHT_INSIDE = 180
const EXPLORER_MAX_WIDTH = 360
const EXPLORER_DEFAULT_WIDTH = 220
const EXPLORER_PREFERRED_WIDTH_RATIO = 0.29
const EXPLORER_GAP = 10

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function resolveExplorerAutoPreferredWidth(spacePixelWidth: number): number {
  // The Explorer should feel like a panel (UI overlay) rather than a canvas element:
  // keep its default width stable and only clamp when the space is too small.
  const derivedPreferredWidth = Math.floor(spacePixelWidth * EXPLORER_PREFERRED_WIDTH_RATIO)
  return derivedPreferredWidth > EXPLORER_DEFAULT_WIDTH
    ? derivedPreferredWidth
    : EXPLORER_DEFAULT_WIDTH
}

export function resolveExplorerPlacement({
  canvasWidth,
  canvasHeight,
  pixelRect,
  preferredWidth,
  preferredHeight,
}: {
  canvasWidth: number
  canvasHeight: number
  pixelRect: SpaceExplorerPixelRect
  preferredWidth: number
  preferredHeight: number
}): SpaceExplorerPlacement {
  // Always render the Explorer inside the space. When the space intersects the viewport edges,
  // we keep the panel size stable (overlay-like) and only adjust its *position* to stay visible.
  const spaceBounds = {
    left: pixelRect.x + EXPLORER_GAP,
    top: pixelRect.y + EXPLORER_GAP,
    right: pixelRect.x + pixelRect.width - EXPLORER_GAP,
    bottom: pixelRect.y + pixelRect.height - EXPLORER_GAP,
  }
  const canvasBounds = {
    left: EXPLORER_GAP,
    top: EXPLORER_GAP,
    right: canvasWidth - EXPLORER_GAP,
    bottom: canvasHeight - EXPLORER_GAP,
  }

  const widthAvailable = Math.max(0, spaceBounds.right - spaceBounds.left)
  const visibleTop = Math.max(spaceBounds.top, canvasBounds.top)
  const visibleBottom = Math.min(spaceBounds.bottom, canvasBounds.bottom)
  const heightAvailable = Math.max(0, visibleBottom - visibleTop)

  // Keep the Explorer "panel-like" instead of menu-like by relating its width to the space size.
  const maxWidth = Math.floor(Math.min(EXPLORER_MAX_WIDTH, widthAvailable))
  const minWidth = Math.min(EXPLORER_MIN_WIDTH_INSIDE, maxWidth)
  const width = clamp(preferredWidth, minWidth, maxWidth)
  const maxHeight = Math.floor(heightAvailable)
  const minHeight = Math.min(EXPLORER_MIN_HEIGHT_INSIDE, maxHeight)
  const height = clamp(preferredHeight, minHeight, maxHeight)

  const clampWithin = (
    value: number,
    bounds: { start: number; end: number },
    size: number,
  ): number => clamp(value, bounds.start, Math.max(bounds.start, bounds.end - size))

  let left = clampWithin(
    spaceBounds.left,
    { start: spaceBounds.left, end: spaceBounds.right },
    width,
  )
  let top = clampWithin(
    spaceBounds.top,
    { start: spaceBounds.top, end: spaceBounds.bottom },
    height,
  )

  // Prefer keeping the panel within the visible canvas area when possible.
  left = clampWithin(left, { start: canvasBounds.left, end: canvasBounds.right }, width)
  top = clampWithin(top, { start: canvasBounds.top, end: canvasBounds.bottom }, height)

  // Always enforce the space boundary last to avoid leaking outside the space.
  left = clampWithin(left, { start: spaceBounds.left, end: spaceBounds.right }, width)
  top = clampWithin(top, { start: spaceBounds.top, end: spaceBounds.bottom }, height)

  return {
    width: Math.round(width),
    height: Math.round(height),
    left: Math.round(left),
    top: Math.round(top),
    minWidth,
    maxWidth,
  }
}
