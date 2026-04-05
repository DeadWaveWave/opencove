export {
  isPointWithinRect,
  placeViewportMenuAtPoint as placeContextMenuAtPoint,
  placeViewportSubmenuAtItem as placeSubmenuAtItem,
  VIEWPORT_MENU_PADDING as VIEWPORT_PADDING,
} from '@app/renderer/components/viewportMenuPlacement'

export const MENU_WIDTH = 188
export const SUBMENU_WIDTH = 240
export const SUBMENU_GAP = 6
// Give users enough time to cross the pointer gap between sibling menus without collapsing
// the submenu mid-flight. The previous 120ms grace period was too short under heavier CI load.
export const SUBMENU_CLOSE_DELAY_MS = 250
export const SUBMENU_MAX_HEIGHT = 640
