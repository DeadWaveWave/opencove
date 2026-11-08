import { PIXEL_ICON_ART_ACTIONS } from './pixelIconArt.actions'
import { PIXEL_ICON_ART_FILES } from './pixelIconArt.files'
import { PIXEL_ICON_ART_LAYOUT } from './pixelIconArt.layout'
import { PIXEL_ICON_ART_OBJECTS } from './pixelIconArt.objects'

/** Every pixel icon's art by its semantic name: what it means, not what it looks like. */
export const PIXEL_ICON_ART = {
  ...PIXEL_ICON_ART_ACTIONS,
  ...PIXEL_ICON_ART_LAYOUT,
  ...PIXEL_ICON_ART_FILES,
  ...PIXEL_ICON_ART_OBJECTS,
}

export type PixelIconName = keyof typeof PIXEL_ICON_ART

/** The art's side in cells. */
export const PIXEL_ICON_GRID = 12

/** The art as rows of cells, top to bottom: `#` paints a cell, `.` leaves it clear. */
export function pixelIconRows(name: PixelIconName): string[] {
  return PIXEL_ICON_ART[name]
    .split('\n')
    .map(row => row.trim())
    .filter(row => row.length > 0)
}
