import { castCursorSpotlight } from './wallSpotlight'
import type { Rgb } from '@shared/design/oklch'
import { PIXEL_WALL } from '@shared/design/themeGenerator'
import type { WallScreenRect } from './wallChrome'
import { GLASS_REACH_CELLS, type WallGrid } from './wallGrid'
import type { WallPalette } from './wallPalette'
import { forEachRingCell, type Ripple } from './ripples'

/** A window's frame in world coordinates, and the light it casts on the wall. */
export interface WallWindowRect {
  x: number
  y: number
  width: number
  height: number
  light?: { color: Rgb; intensity: number }
  /** A working or waiting window: twinkle gathers around it. */
  active?: boolean
}

/** Optional inputs of a wall frame. */
export interface WallCellOptions {
  /** A buffer to reuse while the grid size is unchanged. */
  out?: Uint8ClampedArray
  windows?: readonly WallWindowRect[]
  ripples?: readonly Ripple[]
  /** Screen bands where the shell's top bar and sidebar float on the wall. */
  chrome?: readonly WallScreenRect[]
  /** How much faster than usual the clouds drift (showcase mode). */
  cloudSpeed?: number
  /** Latest pointer in CSS pixels; only used with an ambient clock. */
  spot?: { x: number; y: number } | null
}

const WHITE: Rgb = [255, 255, 255]

/** How strongly a ripple's wavefront pulls a cell toward its colour. */
const RIPPLE_GAIN = 0.62

/** World px per second the clouds drift. */
const CLOUD_DRIFT = 9
/** Share of cells that can twinkle; up to 0.2 more around working windows. */
const SPARK_SHARE = 0.16
/** Cloud colours in the palette. */
const CLOUD_COUNT = 4

function hash2(i: number, j: number): number {
  let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263)) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** Daylight falls across the whole screen, not across the rounded-up grid extent. */
function tileVariation(
  grid: WallGrid,
  appearance: WallPalette['appearance'],
  column: number,
  row: number,
): number {
  const i = grid.firstColumn + column
  const j = grid.firstRow + row
  const weights = PIXEL_WALL[appearance]
  if (appearance === 'dark') {
    return (hash2(i, j) - 0.5) * weights.tileJitter
  }
  const cx = grid.originX + (column + 0.5) * grid.screenCell
  const cy = grid.originY + (row + 0.5) * grid.screenCell
  return (
    (hash2(i * 3 + 7, j * 5 + 11) - 0.5) * weights.tileJitter +
    (0.45 - (cx / grid.width) * 0.55 - (cy / grid.height) * 0.45) * weights.falloff
  )
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

/**
 * Marks the cells behind any window or behind the shell's chrome (screen bands); the cost
 * follows their area, not cells × windows.
 */
function markCellsBehindGlass(
  grid: WallGrid,
  windows: readonly WallWindowRect[],
  chrome: readonly WallScreenRect[],
): Uint8Array | null {
  if (windows.length === 0 && chrome.length === 0) {
    return null
  }
  const behind = new Uint8Array(grid.columns * grid.rows)
  for (const band of chrome) {
    // Any cell the band touches, even partly: its frost covers that part of the cell.
    const first = Math.max(0, Math.floor((band.x - grid.originX) / grid.screenCell))
    const last = Math.min(
      grid.columns - 1,
      Math.ceil((band.x + band.width - grid.originX) / grid.screenCell) - 1,
    )
    const top = Math.max(0, Math.floor((band.y - grid.originY) / grid.screenCell))
    const bottom = Math.min(
      grid.rows - 1,
      Math.ceil((band.y + band.height - grid.originY) / grid.screenCell) - 1,
    )
    for (let row = top; row <= bottom; row++) {
      behind.fill(1, row * grid.columns + first, row * grid.columns + last + 1)
    }
  }
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

/** Mixes `cells[index]` toward `color` by `k`; returns the combined distance moved. */
function mix(cells: Uint8ClampedArray, index: number, color: Rgb, k: number, moved: number) {
  cells[index] += (color[0] - cells[index]!) * k
  cells[index + 1] += (color[1] - cells[index + 1]!) * k
  cells[index + 2] += (color[2] - cells[index + 2]!) * k
  return 1 - (1 - moved) * (1 - k)
}

/**
 * Work light: the cells around a window take its colour. In dark themes the window is the light
 * source and the light spreads out from it; in light themes daylight passes through the coloured
 * glass and lands to the lower right (Tide D12). Cost follows window area, not cells × windows.
 */
function castWorkLight(
  cells: Uint8ClampedArray,
  moved: Float32Array,
  grid: WallGrid,
  windows: readonly WallWindowRect[],
  appearance: WallPalette['appearance'],
) {
  const strength = PIXEL_WALL[appearance].workA
  // 1.5 × the 19.5px midpoint of the screen-cell band, continuous across grid levels.
  const daylight = appearance === 'light'
  const continuousCell = (19.5 * grid.worldCell) / grid.screenCell
  const fall = daylight ? Math.max(30, 0.7 * continuousCell) : Math.max(80, 1.5 * continuousCell)
  const reach = fall * 2.6
  for (const frame of windows) {
    const light = frame.light
    if (!light || light.intensity <= 0) {
      continue
    }
    const x = frame.x + (daylight ? 0.09 * frame.width + 30 : 0)
    const y = frame.y + (daylight ? 0.12 * frame.height + 44 : 0)
    const first = Math.max(0, Math.floor((x - reach) / grid.worldCell) - grid.firstColumn)
    const last = Math.min(
      grid.columns - 1,
      Math.ceil((x + frame.width + reach) / grid.worldCell) - grid.firstColumn,
    )
    const top = Math.max(0, Math.floor((y - reach) / grid.worldCell) - grid.firstRow)
    const bottom = Math.min(
      grid.rows - 1,
      Math.ceil((y + frame.height + reach) / grid.worldCell) - grid.firstRow,
    )
    for (let row = top; row <= bottom; row++) {
      const cy = (grid.firstRow + row + 0.5) * grid.worldCell
      const dy = Math.max(y - cy, 0, cy - (y + frame.height))
      for (let column = first; column <= last; column++) {
        const cx = (grid.firstColumn + column + 0.5) * grid.worldCell
        const dx = Math.max(x - cx, 0, cx - (x + frame.width))
        const d = Math.sqrt(dx * dx + dy * dy) / fall
        const k = light.intensity * strength * Math.exp(-d * d)
        if (k < 0.01) {
          continue
        }
        const cell = row * grid.columns + column
        moved[cell] = mix(cells, cell * 4, light.color, k, moved[cell]!)
      }
    }
  }
}

/**
 * How close each cell is to a working or waiting window, 0 to 1, with the work light's falloff;
 * twinkle gathers there (Tide: "活跃窗口附近更密"). Cost follows the active windows' area.
 */
function markActiveNearness(
  grid: WallGrid,
  windows: readonly WallWindowRect[],
): Float32Array | null {
  const active = windows.filter(frame => frame.active)
  if (active.length === 0) {
    return null
  }
  const near = new Float32Array(grid.columns * grid.rows)
  const fall = Math.max(80, (29.25 * grid.worldCell) / grid.screenCell) * 1.6
  const reach = fall * 4
  for (const frame of active) {
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
        const cell = row * grid.columns + column
        near[cell] = Math.max(near[cell]!, Math.exp(-Math.sqrt(dx * dx + dy * dy) / fall))
      }
    }
  }
  return near
}

/**
 * One colour per visible cell: the theme's cell colour with a little per-tile jitter, soft
 * colour clouds anchored to the world whose hue blends from one cloud colour into the next,
 * wandering bright patches (shimmer), a sparse twinkle in blank space that gathers around
 * working windows, each window's work light, output ripples and finally cursor illumination. Without a clock (`timeSeconds` null: reduced motion, twinkle off, or a lost GPU
 * context) clouds, shimmer and twinkle are still; the lights keep whatever intensity the caller
 * resolved. Shimmer and twinkle never enter glass.
 *
 * Behind a window's glass, and behind the shell's chrome (`chrome`, screen bands where the top
 * bar and sidebar float on the wall), a cell moves at most `cap` toward any colour (Tide I6),
 * the bound the theme contrast checks assume for text over glass.
 */
export function fillWallCells(
  grid: WallGrid,
  palette: WallPalette,
  timeSeconds: number | null,
  {
    out,
    windows = [],
    ripples = [],
    chrome = [],
    cloudSpeed = 1,
    spot = null,
  }: WallCellOptions = {},
): Uint8ClampedArray {
  const count = grid.columns * grid.rows
  const cells = out && out.length === count * 4 ? out : new Uint8ClampedArray(count * 4)
  const moved = new Float32Array(count)
  const behind = markCellsBehindGlass(grid, windows, chrome)
  const near = markActiveNearness(grid, windows)
  const weights = PIXEL_WALL[palette.appearance]
  const time = timeSeconds ?? 0
  const drift = time * CLOUD_DRIFT * cloudSpeed
  // Tide's field sizes are world distances, independent of the discrete grid level.
  const cloudSize = 640
  const hueSize = 1150
  const sheenSize = 300
  const [baseR, baseG, baseB] = palette.cell
  const cloud: [number, number, number] = [0, 0, 0]
  let index = 0
  for (let row = 0; row < grid.rows; row++) {
    const worldRow = grid.firstRow + row
    const wy = (worldRow + 0.5) * grid.worldCell
    for (let column = 0; column < grid.columns; column++, index += 4) {
      const worldColumn = grid.firstColumn + column
      const wx = (worldColumn + 0.5) * grid.worldCell
      const jitter = tileVariation(grid, palette.appearance, column, row)
      cells[index] = baseR + jitter
      cells[index + 1] = baseG + jitter
      cells[index + 2] = baseB + jitter
      cells[index + 3] = 255
      let shift = 0
      const cell = index / 4
      const nx = (wx + drift) / cloudSize
      const ny = (wy - drift * 0.4) / cloudSize
      const amount = smoothstep(
        0.4,
        0.88,
        0.62 * valueNoise(nx, ny) + 0.38 * valueNoise(nx * 2.3 + 7.3, ny * 2.3 - 3.1),
      )
      // The hue blends between neighbouring cloud colours, so clouds never meet at a hard edge.
      const huePosition =
        valueNoise(wx / hueSize + 31.7 + time * 0.006, wy / hueSize + 11.2) * (CLOUD_COUNT - 0.001)
      const hue = Math.floor(huePosition)
      const k = amount * weights.cloudA
      if (k > 0.01) {
        const from = palette.clouds[hue]!
        const to = palette.clouds[Math.min(CLOUD_COUNT - 1, hue + 1)]!
        const blend = huePosition - hue
        cloud[0] = from[0] + (to[0] - from[0]) * blend
        cloud[1] = from[1] + (to[1] - from[1]) * blend
        cloud[2] = from[2] + (to[2] - from[2]) * blend
        shift = mix(cells, index, cloud, k, shift)
      }
      // Shimmer and twinkle stay in blank space: never inside glass.
      if (!behind?.[cell]) {
        const sheen = smoothstep(
          0.6,
          1,
          valueNoise(wx / sheenSize + time * 0.12, wy / sheenSize - time * 0.08),
        )
        if (sheen > 0.01) {
          shift = mix(cells, index, palette.sparks[hue]!, sheen * weights.shimmerA, shift)
        }
        const spark = hash2(worldColumn * 7, worldRow * 13)
        const share = SPARK_SHARE + 0.2 * (near?.[cell] ?? 0)
        if (timeSeconds !== null && spark > 1 - share) {
          const twinkle =
            Math.max(0, Math.sin(time * (0.6 + spark * 1.6) + spark * 50)) ** 24 * weights.sparkA
          if (twinkle > 0.02) {
            shift = mix(
              cells,
              index,
              palette.appearance === 'light' && spark > 0.95 ? WHITE : palette.sparks[hue]!,
              twinkle,
              shift,
            )
          }
        }
      }
      moved[cell] = shift
    }
  }
  castWorkLight(cells, moved, grid, windows, palette.appearance)
  // Output ripples brighten the cells their wavefront passes, in the window's kind colour.
  for (const ripple of ripples) {
    forEachRingCell(grid, ripple, (column, row, weight) => {
      const k = (ripple.gain ?? RIPPLE_GAIN) * ripple.strength * weight
      if (k < 0.01) {
        return
      }
      const cell = row * grid.columns + column
      moved[cell] = mix(cells, cell * 4, ripple.color, k, moved[cell]!)
      // The shockwave's white crest stays in blank space: behind glass only the window colour
      // may show, which keeps text over glass within its checked contrast (Tide).
      if (ripple.crest && weight > 0.5 && !behind?.[cell]) {
        moved[cell] = mix(cells, cell * 4, WHITE, Math.min(1, k * (weight - 0.5) * 2), moved[cell]!)
      }
    })
  }
  if (spot && timeSeconds !== null) {
    castCursorSpotlight(cells, moved, grid, palette, spot, windows, chrome)
  }
  if (behind) {
    for (let cell = 0; cell < count; cell++) {
      if (!behind[cell] || moved[cell]! <= weights.cap) {
        continue
      }
      // Pull the cell back toward its tile colour until it has moved exactly `cap`.
      const scale = weights.cap / moved[cell]!
      const jitter = tileVariation(
        grid,
        palette.appearance,
        cell % grid.columns,
        Math.floor(cell / grid.columns),
      )
      const at = cell * 4
      cells[at] = baseR + jitter + (cells[at]! - baseR - jitter) * scale
      cells[at + 1] = baseG + jitter + (cells[at + 1]! - baseG - jitter) * scale
      cells[at + 2] = baseB + jitter + (cells[at + 2]! - baseB - jitter) * scale
    }
  }
  return cells
}
