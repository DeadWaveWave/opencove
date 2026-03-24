export const MENU_WIDTH = 188
export const SUBMENU_WIDTH = 240
export const VIEWPORT_PADDING = 12
export const SUBMENU_GAP = 6
export const SUBMENU_CLOSE_DELAY_MS = 120
export const SUBMENU_MAX_HEIGHT = 640

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

function clampMenuCoordinate(
  origin: number,
  size: number,
  viewportExtent: number,
  padding: number,
): number {
  return Math.max(padding, Math.min(origin, Math.max(padding, viewportExtent - padding - size)))
}

export function placeContextMenuAtPoint(options: {
  point: MenuPoint
  menuSize: MenuSize
  viewport: MenuViewportSize
  padding?: number
}): { left: number; top: number } {
  const padding = options.padding ?? VIEWPORT_PADDING

  return {
    left: clampMenuCoordinate(
      options.point.x,
      options.menuSize.width,
      options.viewport.width,
      padding,
    ),
    top: clampMenuCoordinate(
      options.point.y,
      options.menuSize.height,
      options.viewport.height,
      padding,
    ),
  }
}

export function placeSubmenuAtItem(options: {
  parentMenuRect: MenuRect
  itemRect: MenuRect
  submenuSize: MenuSize
  viewport: MenuViewportSize
  padding?: number
  gap?: number
}): { left: number; top: number; side: 'left' | 'right' } {
  const padding = options.padding ?? VIEWPORT_PADDING
  const gap = options.gap ?? SUBMENU_GAP
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
