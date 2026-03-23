export const MENU_WIDTH = 188
export const SUBMENU_WIDTH = 188
export const VIEWPORT_PADDING = 12
export const SUBMENU_GAP = 6
export const SUBMENU_CLOSE_DELAY_MS = 120
export const SUBMENU_MAX_HEIGHT = 640

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
