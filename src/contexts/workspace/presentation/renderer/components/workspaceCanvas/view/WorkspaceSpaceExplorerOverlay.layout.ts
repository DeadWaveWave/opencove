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
const EXPLORER_MAX_WIDTH = 360
const EXPLORER_DEFAULT_WIDTH = 240
const EXPLORER_PREFERRED_WIDTH_RATIO = 0.34
const EXPLORER_GAP = 10

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function resolveExplorerAutoPreferredWidth(spacePixelWidth: number): number {
  const derivedPreferredWidth = Math.floor(spacePixelWidth * EXPLORER_PREFERRED_WIDTH_RATIO)
  return derivedPreferredWidth > 0
    ? Math.min(derivedPreferredWidth, EXPLORER_DEFAULT_WIDTH)
    : EXPLORER_DEFAULT_WIDTH
}

export function resolveExplorerPlacement({
  canvasWidth,
  canvasHeight,
  pixelRect,
  preferredWidth,
}: {
  canvasWidth: number
  canvasHeight: number
  pixelRect: SpaceExplorerPixelRect
  preferredWidth: number
}): SpaceExplorerPlacement {
  // Always render the Explorer inside the space. To keep it usable near viewport edges, clamp
  // the overlay to the visible intersection (canvas bounds ∩ space bounds).
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

  const bounds = {
    left: Math.max(spaceBounds.left, canvasBounds.left),
    top: Math.max(spaceBounds.top, canvasBounds.top),
    right: Math.min(spaceBounds.right, canvasBounds.right),
    bottom: Math.min(spaceBounds.bottom, canvasBounds.bottom),
  }

  const widthAvailable = Math.max(0, bounds.right - bounds.left)
  const heightAvailable = Math.max(0, bounds.bottom - bounds.top)

  // Keep the Explorer "panel-like" instead of menu-like by relating its width to the space size.
  const maxWidth = Math.floor(Math.min(EXPLORER_MAX_WIDTH, widthAvailable))
  const minWidth = Math.min(EXPLORER_MIN_WIDTH_INSIDE, maxWidth)
  const width = clamp(preferredWidth, minWidth, maxWidth)

  return {
    width: Math.round(width),
    height: Math.round(heightAvailable),
    left: Math.round(bounds.left),
    top: Math.round(bounds.top),
    minWidth,
    maxWidth,
  }
}
