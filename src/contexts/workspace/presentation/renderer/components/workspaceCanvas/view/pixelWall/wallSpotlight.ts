import type { Rgb } from '@shared/design/oklch'
import { PIXEL_WALL } from '@shared/design/themeGenerator'
import type { WallWindowRect } from './wallCells'
import type { WallScreenRect } from './wallChrome'
import { GLASS_REACH_CELLS, type WallGrid } from './wallGrid'
import type { WallPalette } from './wallPalette'

/** Tide 1805–1806: radius and softness are in CSS pixels, independent of zoom. */
const REACH_SQ = 160_000
const SOFTNESS = 52_000
/** Two base screen cells soften both the frame edge and entry into the glass budget. */
const EDGE_SOFTNESS = 48 ** 2
const distance = (x: number, y: number, rect: WallWindowRect | WallScreenRect) =>
  Math.hypot(
    Math.max(rect.x - x, 0, x - rect.x - rect.width),
    Math.max(rect.y - y, 0, y - rect.y - rect.height),
  )

/**
 * The light's own colour on a finished tile. Dark walls are lit additively (screen), so a
 * kind-lit tile turns brighter and takes some of the light's hue: the two colours mix. Light walls
 * keep Tide's tint toward the light colour (1805–1806), as daylight through coloured glass does.
 */
function illuminatedTile(tile: Rgb, light: Rgb, daylight: boolean): Rgb {
  if (daylight) {
    return light
  }
  return [
    tile[0] + ((255 - tile[0]) * light[0]) / 255,
    tile[1] + ((255 - tile[1]) * light[1]) / 255,
    tile[2] + ((255 - tile[2]) * light[2]) / 255,
  ]
}

/** Adds light last, reserving only the remaining I6 budget before the caller applies its cap. */
export function castCursorSpotlight(
  cells: Uint8ClampedArray,
  moved: Float32Array,
  grid: WallGrid,
  palette: WallPalette,
  spot: { x: number; y: number },
  windows: readonly WallWindowRect[],
  chrome: readonly WallScreenRect[],
): void {
  const weights = PIXEL_WALL[palette.appearance]
  const zoom = grid.screenCell / grid.worldCell
  // Distances are bounded to the cursor's neighbourhood; distant windows cannot affect it.
  const frames = windows
    .map(frame => ({
      x: grid.originX + (frame.x / grid.worldCell - grid.firstColumn) * grid.screenCell,
      y: grid.originY + (frame.y / grid.worldCell - grid.firstRow) * grid.screenCell,
      width: frame.width * zoom,
      height: frame.height * zoom,
    }))
    .filter(
      frame => distance(spot.x, spot.y, frame) < 400 + GLASS_REACH_CELLS * grid.screenCell + 144,
    )
  const first = Math.max(0, Math.floor((spot.x - 400 - grid.originX) / grid.screenCell))
  const last = Math.min(
    grid.columns - 1,
    Math.floor((spot.x + 400 - grid.originX) / grid.screenCell),
  )
  const top = Math.max(0, Math.floor((spot.y - 400 - grid.originY) / grid.screenCell))
  const bottom = Math.min(
    grid.rows - 1,
    Math.floor((spot.y + 400 - grid.originY) / grid.screenCell),
  )
  for (let row = top; row <= bottom; row++) {
    const y = grid.originY + (row + 0.5) * grid.screenCell
    for (let column = first; column <= last; column++) {
      const x = grid.originX + (column + 0.5) * grid.screenCell
      const d2 = (x - spot.x) ** 2 + (y - spot.y) ** 2
      if (d2 >= REACH_SQ) {
        continue
      }
      let frameDistance = Infinity
      for (const frame of frames) {
        frameDistance = Math.min(frameDistance, distance(x, y, frame))
      }
      if (frameDistance <= 0) {
        continue
      }
      let glassDistance = Math.max(0, frameDistance - GLASS_REACH_CELLS * grid.screenCell)
      for (const band of chrome) {
        glassDistance = Math.min(glassDistance, distance(x, y, band))
      }
      const edge = 1 - Math.exp(-(frameDistance ** 2) / EDGE_SOFTNESS)
      const glass = Math.exp(-(glassDistance ** 2) / EDGE_SOFTNESS)
      const cell = row * grid.columns + column
      let k = weights.spotA * Math.exp(-d2 / SOFTNESS) * edge
      const remaining = Math.max(0, (weights.cap - moved[cell]!) / (1 - moved[cell]!))
      // Ease into the budget outside the glass band too, so entering it introduces no step.
      k += (Math.min(k, remaining) - k) * glass
      if (k <= 0) {
        continue
      }
      const at = cell * 4
      const target = illuminatedTile(
        [cells[at]!, cells[at + 1]!, cells[at + 2]!],
        palette.spot,
        palette.appearance === 'light',
      )
      for (let channel = 0; channel < 3; channel++) {
        cells[at + channel] += (target[channel]! - cells[at + channel]!) * k
      }
      moved[cell] = 1 - (1 - moved[cell]!) * (1 - k)
    }
  }
}
