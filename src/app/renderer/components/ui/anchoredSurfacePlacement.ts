export type AnchoredSurfaceSide = 'bottom' | 'top'
export type AnchoredSurfaceAlign = 'start' | 'center' | 'end'

export interface AnchoredSurfaceRect {
  left: number
  right: number
  top: number
  bottom: number
  width: number
  height: number
}

export interface AnchoredSurfaceSize {
  width: number
  height: number
}

export interface AnchoredSurfaceViewport {
  width: number
  height: number
}

export interface AnchoredSurfacePlacement {
  left: number
  top: number
  side: AnchoredSurfaceSide
}

function clampCoordinate(
  coordinate: number,
  surfaceExtent: number,
  viewportExtent: number,
  padding: number,
): number {
  const maximum = Math.max(padding, viewportExtent - padding - surfaceExtent)
  return Math.min(Math.max(coordinate, padding), maximum)
}

function resolveSide(options: {
  preferredSide: AnchoredSurfaceSide
  anchorRect: AnchoredSurfaceRect
  surfaceHeight: number
  viewportHeight: number
  offset: number
  padding: number
}): AnchoredSurfaceSide {
  const { preferredSide, anchorRect, surfaceHeight, viewportHeight, offset, padding } = options
  const availableBySide: Record<AnchoredSurfaceSide, number> = {
    bottom: viewportHeight - padding - anchorRect.bottom - offset,
    top: anchorRect.top - padding - offset,
  }
  const oppositeSide: AnchoredSurfaceSide = preferredSide === 'bottom' ? 'top' : 'bottom'

  if (surfaceHeight <= availableBySide[preferredSide]) {
    return preferredSide
  }

  if (surfaceHeight <= availableBySide[oppositeSide]) {
    return oppositeSide
  }

  return availableBySide[oppositeSide] > availableBySide[preferredSide]
    ? oppositeSide
    : preferredSide
}

function resolveAlignedLeft(options: {
  anchorRect: AnchoredSurfaceRect
  surfaceWidth: number
  align: AnchoredSurfaceAlign
}): number {
  const { anchorRect, surfaceWidth, align } = options

  if (align === 'center') {
    return anchorRect.left + (anchorRect.width - surfaceWidth) / 2
  }

  if (align === 'end') {
    return anchorRect.right - surfaceWidth
  }

  return anchorRect.left
}

export function placeAnchoredSurface(options: {
  anchorRect: AnchoredSurfaceRect
  surfaceSize: AnchoredSurfaceSize
  viewport: AnchoredSurfaceViewport
  side?: AnchoredSurfaceSide
  align?: AnchoredSurfaceAlign
  offset?: number
  collisionPadding?: number
}): AnchoredSurfacePlacement {
  const side = options.side ?? 'bottom'
  const align = options.align ?? 'start'
  const offset = options.offset ?? 8
  const padding = Math.max(0, options.collisionPadding ?? 12)
  const resolvedSide = resolveSide({
    preferredSide: side,
    anchorRect: options.anchorRect,
    surfaceHeight: options.surfaceSize.height,
    viewportHeight: options.viewport.height,
    offset,
    padding,
  })
  const rawTop =
    resolvedSide === 'bottom'
      ? options.anchorRect.bottom + offset
      : options.anchorRect.top - offset - options.surfaceSize.height
  const rawLeft = resolveAlignedLeft({
    anchorRect: options.anchorRect,
    surfaceWidth: options.surfaceSize.width,
    align,
  })

  return {
    left: clampCoordinate(rawLeft, options.surfaceSize.width, options.viewport.width, padding),
    top: clampCoordinate(rawTop, options.surfaceSize.height, options.viewport.height, padding),
    side: resolvedSide,
  }
}
