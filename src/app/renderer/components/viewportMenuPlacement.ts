export const VIEWPORT_MENU_PADDING = 12

export interface MenuViewportSize {
  width: number
  height: number
}

export interface MenuSize {
  width: number
  height: number
}

export interface MenuRect {
  left: number
  top: number
  width: number
  height: number
}

export interface MenuPoint {
  x: number
  y: number
}

export type MenuPointAlignment = 'start' | 'end' | 'auto'

function clampMenuCoordinate(
  origin: number,
  size: number,
  viewportExtent: number,
  padding: number,
): number {
  return Math.max(padding, Math.min(origin, Math.max(padding, viewportExtent - padding - size)))
}

function resolveAlignedCoordinate(options: {
  origin: number
  size: number
  viewportExtent: number
  padding: number
  alignment: MenuPointAlignment
}): number {
  const { origin, size, viewportExtent, padding, alignment } = options
  const startCoordinate = origin
  const endCoordinate = origin - size

  if (alignment === 'start') {
    return clampMenuCoordinate(startCoordinate, size, viewportExtent, padding)
  }

  if (alignment === 'end') {
    return clampMenuCoordinate(endCoordinate, size, viewportExtent, padding)
  }

  const startFits = startCoordinate + size <= viewportExtent - padding
  const endFits = endCoordinate >= padding

  if (startFits || !endFits) {
    return clampMenuCoordinate(startCoordinate, size, viewportExtent, padding)
  }

  return clampMenuCoordinate(endCoordinate, size, viewportExtent, padding)
}

export function placeViewportMenuAtPoint(options: {
  point: MenuPoint
  menuSize: MenuSize
  viewport: MenuViewportSize
  padding?: number
  alignX?: MenuPointAlignment
  alignY?: MenuPointAlignment
}): { left: number; top: number } {
  const padding = options.padding ?? VIEWPORT_MENU_PADDING

  return {
    left: resolveAlignedCoordinate({
      origin: options.point.x,
      size: options.menuSize.width,
      viewportExtent: options.viewport.width,
      padding,
      alignment: options.alignX ?? 'start',
    }),
    top: resolveAlignedCoordinate({
      origin: options.point.y,
      size: options.menuSize.height,
      viewportExtent: options.viewport.height,
      padding,
      alignment: options.alignY ?? 'start',
    }),
  }
}

export function placeViewportSubmenuAtItem(options: {
  parentMenuRect: MenuRect
  itemRect: MenuRect
  submenuSize: MenuSize
  viewport: MenuViewportSize
  padding?: number
  gap?: number
}): { left: number; top: number; side: 'left' | 'right' } {
  const padding = options.padding ?? VIEWPORT_MENU_PADDING
  const gap = options.gap ?? 6
  const preferredRight = options.parentMenuRect.left + options.parentMenuRect.width + gap
  const preferredLeft = options.parentMenuRect.left - gap - options.submenuSize.width
  const fitsRight = preferredRight + options.submenuSize.width <= options.viewport.width - padding
  const fitsLeft = preferredLeft >= padding

  let side: 'left' | 'right' = 'right'
  let rawLeft = preferredRight

  if (!fitsRight && fitsLeft) {
    side = 'left'
    rawLeft = preferredLeft
  } else if (!fitsRight && !fitsLeft) {
    const availableRight = options.viewport.width - padding - preferredRight
    const availableLeft = options.parentMenuRect.left - gap - padding
    side = availableLeft > availableRight ? 'left' : 'right'
    rawLeft = side === 'left' ? preferredLeft : preferredRight
  }

  return {
    side,
    left: clampMenuCoordinate(rawLeft, options.submenuSize.width, options.viewport.width, padding),
    top: clampMenuCoordinate(
      options.itemRect.top,
      options.submenuSize.height,
      options.viewport.height,
      padding,
    ),
  }
}

export function isPointWithinRect(
  point: { x: number; y: number },
  rect: { x: number; y: number; width: number; height: number },
): boolean {
  return (
    point.x >= rect.x &&
    point.y >= rect.y &&
    point.x <= rect.x + rect.width &&
    point.y <= rect.y + rect.height
  )
}
