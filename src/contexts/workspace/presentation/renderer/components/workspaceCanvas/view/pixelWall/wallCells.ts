import { PIXEL_WALL } from '@shared/design/themeGenerator'
import type { WallGrid } from './wallGrid'
import type { WallPalette } from './wallPalette'

/** A window's frame in world coordinates. */
export interface WallWindowRect {
  x: number
  y: number
  width: number
  height: number
}

/** Cells within this many cells of a window count as behind its glass, frame shadow included. */
const GLASS_REACH_CELLS = 2

/** World px per second the clouds drift. */
const CLOUD_DRIFT = 9
/** Share of cells that can twinkle. */
const SPARK_SHARE = 0.16

function hash2(i: number, j: number): number {
  let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263)) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

function valueNoise(x: number, y: number): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const xf = x - xi
  const yf = y - yi
  const u = xf * xf * (3 - 2 * xf)
  const v = yf * yf * (3 - 2 * yf)
  const a = hash2(xi, yi)
  const b = hash2(xi + 1, yi)
  const c = hash2(xi, yi + 1)
  const d = hash2(xi + 1, yi + 1)
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

/** Marks the cells behind any window; the cost follows window area, not cells × windows. */
function markCellsBehindGlass(
  grid: WallGrid,
  windows: readonly WallWindowRect[],
): Uint8Array | null {
  if (windows.length === 0) {
    return null
  }
  const behind = new Uint8Array(grid.columns * grid.rows)
  const reach = GLASS_REACH_CELLS * grid.worldCell
  for (const frame of windows) {
    const first = Math.max(0, Math.floor((frame.x - reach) / grid.worldCell) - grid.firstColumn)
    const last = Math.min(
      grid.columns - 1,
      Math.ceil((frame.x + frame.width + reach) / grid.worldCell) - grid.firstColumn,
    )
    const top = Math.max(0, Math.floor((frame.y - reach) / grid.worldCell) - grid.firstRow)
    const bottom = Math.min(
      grid.rows - 1,
      Math.ceil((frame.y + frame.height + reach) / grid.worldCell) - grid.firstRow,
    )
    for (let row = top; row <= bottom; row++) {
      const cy = (grid.firstRow + row + 0.5) * grid.worldCell
      const dy = Math.max(frame.y - cy, 0, cy - (frame.y + frame.height))
      for (let column = first; column <= last; column++) {
        const cx = (grid.firstColumn + column + 0.5) * grid.worldCell
        const dx = Math.max(frame.x - cx, 0, cx - (frame.x + frame.width))
        if (dx * dx + dy * dy <= reach * reach) {
          behind[row * grid.columns + column] = 1
        }
      }
    }
  }
  return behind
}

/**
 * One colour per visible cell: the theme's cell colour with a little per-tile jitter, soft
 * colour clouds anchored to the world, and a sparse twinkle. Without a clock (`timeSeconds`
 * null: reduced motion, or a lost GPU context) the wall is still: no drift and no twinkle.
 *
 * Behind a window's glass a cell moves at most `cap` toward any colour (Tide I6), the bound
 * the theme contrast checks assume for text over glass.
 */
export function fillWallCells(
  grid: WallGrid,
  palette: WallPalette,
  timeSeconds: number | null,
  out?: Uint8ClampedArray,
  windows: readonly WallWindowRect[] = [],
): Uint8ClampedArray {
  const count = grid.columns * grid.rows
  const cells = out && out.length === count * 4 ? out : new Uint8ClampedArray(count * 4)
  const behind = markCellsBehindGlass(grid, windows)
  const weights = PIXEL_WALL[palette.appearance]
  const time = timeSeconds ?? 0
  const drift = time * CLOUD_DRIFT
  const [baseR, baseG, baseB] = palette.cell
  let index = 0
  for (let row = 0; row < grid.rows; row++) {
    const worldRow = grid.firstRow + row
    const wy = (worldRow + 0.5) * grid.worldCell
    for (let column = 0; column < grid.columns; column++, index += 4) {
      const worldColumn = grid.firstColumn + column
      const wx = (worldColumn + 0.5) * grid.worldCell
      const jitter = (hash2(worldColumn, worldRow) - 0.5) * weights.tileJitter
      const tileR = baseR + jitter
      const tileG = baseG + jitter
      const tileB = baseB + jitter
      let r = tileR
      let g = tileG
      let b = tileB
      // How far the cell has moved from its tile colour, combined over every mix.
      let moved = 0
      const amount = smoothstep(
        0.4,
        0.88,
        0.62 * valueNoise((wx + drift) / 640, wy / 640) +
          0.38 * valueNoise((wx + drift) / 278 + 7.3, wy / 278 - 3.1),
      )
      const hue = Math.min(3, Math.floor(valueNoise(wx / 1150 + 31.7, wy / 1150 + 11.2) * 4))
      const cloud = palette.clouds[hue]!
      const k = amount * weights.cloudA
      if (k > 0.01) {
        r += (cloud[0] - r) * k
        g += (cloud[1] - g) * k
        b += (cloud[2] - b) * k
        moved = k
      }
      const spark = hash2(worldColumn * 7, worldRow * 13)
      if (timeSeconds !== null && spark > 1 - SPARK_SHARE) {
        const twinkle = Math.max(0, Math.sin(time * (0.6 + spark * 1.6) + spark * 50)) ** 24 * 0.85
        if (twinkle > 0.02) {
          const color = palette.sparks[hue]!
          r += (color[0] - r) * twinkle
          g += (color[1] - g) * twinkle
          b += (color[2] - b) * twinkle
          moved = 1 - (1 - moved) * (1 - twinkle)
        }
      }
      if (behind?.[index / 4] && moved > weights.cap) {
        const scale = weights.cap / moved
        r = tileR + (r - tileR) * scale
        g = tileG + (g - tileG) * scale
        b = tileB + (b - tileB) * scale
      }
      cells[index] = r
      cells[index + 1] = g
      cells[index + 2] = b
      cells[index + 3] = 255
    }
  }
  return cells
}
