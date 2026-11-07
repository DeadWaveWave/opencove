import { describe, expect, it } from 'vitest'
import { castCursorSpotlight } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/pixelWall/wallSpotlight'
import {
  deltaE,
  mixOver,
  relativeLuminance,
  rgbToOklab,
  type Rgb,
} from '../../../src/shared/design/oklch'
import { generateFamilyTheme, PIXEL_WALL } from '../../../src/shared/design/themeGenerator'
import {
  fillWallCells,
  type WallWindowRect,
} from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/pixelWall/wallCells'
import { resolveWallGrid } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/pixelWall/wallGrid'
import {
  readWallPalette,
  type WallPalette,
} from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/pixelWall/wallPalette'

const grid = resolveWallGrid({ x: 0, y: 0, zoom: 1, width: 1200, height: 900 })
const pixel = (cells: Uint8ClampedArray, column: number, row: number): Rgb => {
  const at = (row * grid.columns + column) * 4
  return [cells[at]!, cells[at + 1]!, cells[at + 2]!]
}
const hue = (rgb: Rgb) => {
  const [, a, b] = rgbToOklab(rgb)
  return { h: (Math.atan2(b, a) * 180) / Math.PI, c: Math.hypot(a, b) }
}
const hueShift = (a: Rgb, b: Rgb) => Math.abs(((hue(a).h - hue(b).h + 540) % 360) - 180)
const frame = { x: 480, y: 240, width: 240, height: 288 }

for (const appearance of ['dark', 'light'] as const) {
  const theme = generateFamilyTheme('cove', appearance)
  const palette: WallPalette = { ...theme.pixel, appearance, spot: theme.accent[8]! }
  describe(`${appearance} cursor illumination`, () => {
    it('lights open wall, retaining the old peak luminance change within 15%', () => {
      const without = fillWallCells(grid, palette, 0)
      // Brightest open-wall tile in the central region, not a twinkle peak at another time.
      let column = 10,
        row = 10
      for (let r = 8; r < 25; r++) {
        for (let c = 10; c < 35; c++) {
          if (
            relativeLuminance(pixel(without, c, r)) > relativeLuminance(pixel(without, column, row))
          ) {
            column = c
            row = r
          }
        }
      }
      const spot = { x: (column + 0.5) * grid.screenCell, y: (row + 0.5) * grid.screenCell }
      const lit = fillWallCells(grid, palette, 0, { spot })
      const base = pixel(without, column, row)
      const before = mixOver(
        appearance === 'dark' ? [255, 255, 255] : theme.accent[8]!,
        appearance === 'dark' ? 0.24 : 0.2,
        base,
      )
      const oldChange = Math.abs(relativeLuminance(before) - relativeLuminance(base))
      // Dark walls brighten; light walls keep Tide's slightly darker accent tint.
      const change = Math.abs(relativeLuminance(pixel(lit, column, row)) - relativeLuminance(base))
      expect(change / oldChange).toBeGreaterThanOrEqual(0.85)
      expect(change / oldChange).toBeLessThanOrEqual(1.15)
      const farColumn = column < grid.columns / 2 ? grid.columns - 1 : 0
      expect(pixel(lit, farColumn, 0)).toEqual(pixel(without, farColumn, 0))
    })

    it('mixes into finished kind light and ripples without replacing their hue', () => {
      let checked = 0
      let maxShare = 0
      for (const kind of Object.values(theme.kinds)) {
        const windows = [{ ...frame, light: { color: kind[8]!, intensity: 0.8 } }]
        const ripples = [{ x: 600, y: 384, radius: 180, band: 40, strength: 0.3, color: kind[8]! }]
        const spot = { x: 780, y: 372 }
        const base = fillWallCells(grid, palette, 0, { windows, ripples })
        const lit = fillWallCells(grid, palette, 0, { windows, ripples, spot })
        // Probe outside the glass band: a fully spent glass budget correctly adds nothing.
        for (let column = 32; column < 37; column++) {
          const a = pixel(base, column, 15),
            b = pixel(lit, column, 15)
          if (hue(a).c < 0.05) {
            continue
          }
          if (appearance === 'dark') {
            expect(relativeLuminance(b)).toBeGreaterThan(relativeLuminance(a))
          }
          // The two colours mix: the hue moves toward the light's and stops between them.
          const gap = hueShift(a, palette.spot)
          if (gap > 20) {
            expect(hueShift(b, palette.spot)).toBeLessThan(gap)
            expect(hueShift(a, b) + hueShift(b, palette.spot)).toBeLessThanOrEqual(gap + 2)
            maxShare = Math.max(maxShare, hueShift(a, b) / gap)
          }
          checked++
        }
      }
      expect(checked).toBeGreaterThan(5)
    })

    it.each([false, true])(
      'fades continuously to the original frame with work light %s',
      workLight => {
        const windows: WallWindowRect[] = [
          {
            ...frame,
            y: 0,
            ...(workLight ? { light: { color: theme.kinds.ai[8]!, intensity: 0.35 } } : {}),
          },
        ]
        // A low-cloud strip leaves budget for the edge fade; saturated glass is tested below.
        const plain = {
          ...palette,
          clouds: palette.clouds.map(() => palette.cell),
          sparks: palette.sparks.map(() => palette.cell),
        }
        const spot = { x: appearance === 'dark' ? 468 : 732, y: 108 }
        const base = fillWallCells(grid, plain, 0, { windows })
        const lit = fillWallCells(grid, plain, 0, { windows, spot })
        const gains: number[] = []
        const columns = Array.from({ length: 15 }, (_, i) =>
          appearance === 'dark' ? 5 + i : 44 - i,
        )
        for (const column of columns) {
          const a = pixel(base, column, 4),
            b = pixel(lit, column, 4)
          gains.push(Math.max(...b.map((value, channel) => Math.abs(value - a[channel]!))))
        }
        // |d exp(-x²/s²)/dx| ≤ sqrt(2/e)/s. Sum the footprint and frame-fade
        // slopes over one 24px step, with 2 RGB units for the two rounded frames.
        // Screen moves a channel at most to 255; a tint at most to the light's own channel.
        const headroom = Math.max(
          ...columns.flatMap(column =>
            pixel(base, column, 4).map((value, channel) =>
              appearance === 'dark' ? 255 - value : Math.abs(palette.spot[channel]! - value),
            ),
          ),
        )
        const bound =
          headroom *
            PIXEL_WALL[appearance].spotA *
            Math.sqrt(2 / Math.E) *
            grid.screenCell *
            (1 / Math.sqrt(52000) + 1 / 48) +
          2
        const drops = gains.slice(1).map((gain, i) => gains[i]! - gain)
        expect(Math.max(...drops)).toBeLessThanOrEqual(bound)
        expect(gains[12]).toBeGreaterThan(0) // The former hard two-cell exclusion ring.
        expect(gains[13]).toBeGreaterThan(0)
        const insideColumn = appearance === 'dark' ? 20 : 29
        expect(pixel(lit, insideColumn, 4)).toEqual(pixel(base, insideColumn, 4)) // Inside adds nothing.
      },
    )

    it('adds at most the remaining cap behind glass and shell chrome', () => {
      const black: Rgb = [0, 0, 0],
        white: Rgb = [255, 255, 255]
      const p = {
        ...palette,
        cell: black,
        clouds: [white, white, white, white],
        sparks: [white, white, white, white],
        spot: white,
      }
      const windows = [{ ...frame, light: { color: white, intensity: 1 } }]
      const chrome = [{ x: 0, y: 0, width: 480, height: 900 }]
      const spot = { x: 468, y: 372 }
      const lit = fillWallCells(grid, p, 3.3, { windows, chrome, spot })
      const limit =
        PIXEL_WALL[appearance].cap * 255 +
        PIXEL_WALL[appearance].tileJitter +
        PIXEL_WALL[appearance].falloff
      for (let column = 0; column < 32; column++) {
        expect(Math.max(...pixel(lit, column, 15))).toBeLessThanOrEqual(limit)
      }
    })

    it('reserves the remaining glass budget before final cap normalization', () => {
      const cells = new Uint8ClampedArray(grid.columns * grid.rows * 4).fill(40)
      const moved = new Float32Array(grid.columns * grid.rows).fill(
        PIXEL_WALL[appearance].cap - 0.01,
      )
      const chrome = [{ x: 0, y: 0, width: 1200, height: 900 }]
      castCursorSpotlight(cells, moved, grid, palette, { x: 444, y: 108 }, [], chrome)
      expect(Math.max(...moved)).toBeLessThanOrEqual(PIXEL_WALL[appearance].cap + 1e-6)
      const spent = cells.slice()
      moved.fill(0.8)
      castCursorSpotlight(cells, moved, grid, palette, { x: 444, y: 108 }, [], chrome)
      expect(cells).toEqual(spent)
    })

    it('holds still without an ambient clock even when a pointer is supplied', () => {
      expect(fillWallCells(grid, palette, null, { spot: { x: 480, y: 360 } })).toEqual(
        fillWallCells(grid, palette, null),
      )
    })
  })
}

it('uses accent[8] for generated themes and a coloured Pixel fallback', () => {
  const host = document.createElement('div')
  document.body.append(host)
  try {
    const fallback = readWallPalette(host)
    expect(fallback.spot).not.toEqual([255, 255, 255])
    expect(deltaE(fallback.spot, [255, 255, 255])).toBeGreaterThan(10)
    host.style.setProperty('--cove-accent', '#5b9cf0')
    expect(readWallPalette(host).spot).toEqual([91, 156, 240])
    for (const appearance of ['dark', 'light'] as const) {
      const theme = generateFamilyTheme('cove', appearance)
      expect(theme.pixel.spot).toEqual(theme.accent[8])
    }
  } finally {
    host.remove()
  }
})
