import { describe, expect, it } from 'vitest'
import { deltaE, type Rgb } from '../../../src/shared/design/oklch'
import { generateFamilyTheme } from '../../../src/shared/design/themeGenerator'
import {
  fillWallCells,
  type WallWindowRect,
} from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/pixelWall/wallCells'
import { resolveWallGrid } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/pixelWall/wallGrid'

const windows: WallWindowRect[] = [
  {
    x: 320,
    y: 220,
    width: 360,
    height: 260,
    light: { color: [180, 148, 239], intensity: 0.8 },
    active: true,
  },
  {
    x: -1400,
    y: -700,
    width: 600,
    height: 380,
    light: { color: [140, 217, 178], intensity: 0.7 },
    active: true,
  },
  { x: 1800, y: 900, width: 500, height: 300, light: { color: [228, 175, 116], intensity: 0.6 } },
]
const distance = (x: number, y: number, frame: WallWindowRect) =>
  Math.hypot(
    Math.max(frame.x - x, 0, x - frame.x - frame.width),
    Math.max(frame.y - y, 0, y - frame.y - frame.height),
  )
const stats = (values: number[]) => {
  values.sort((a, b) => a - b)
  return {
    count: values.length,
    mean: values.reduce((a, b) => a + b, 0) / values.length,
    p99: values[Math.floor(values.length * 0.99)]!,
  }
}

describe('pixel wall colour continuity across cell levels', () => {
  for (const appearance of ['dark', 'light'] as const) {
    for (const fineSize of [24, 48, 96]) {
      it(`${appearance}: area averages ${fineSize}px cells into ${fineSize * 2}px cells`, () => {
        const boundary = 13 / fineSize
        const view = (zoom: number) =>
          resolveWallGrid({
            x: 720 - 300 * zoom,
            y: 450 - 200 * zoom,
            zoom,
            width: 1440,
            height: 900,
          })
        const fine = view(boundary * 1.00001)
        const coarse = view(boundary * 0.99999)
        expect(coarse.worldCell).toBe(fine.worldCell * 2)
        const palette = { ...generateFamilyTheme('cove', appearance).pixel, appearance }
        // A null ambient clock excludes twinkle but retains the static cloud and shimmer field.
        const a = fillWallCells(fine, palette, null, { windows })
        const b = fillWallCells(coarse, palette, null, { windows })
        const open: number[] = []
        const band: number[] = []
        for (let row = 0; row < coarse.rows; row++) {
          for (let column = 0; column < coarse.columns; column++) {
            const wx = (coarse.firstColumn + column) * coarse.worldCell
            const wy = (coarse.firstRow + row) * coarse.worldCell
            const c = wx / fine.worldCell - fine.firstColumn
            const r = wy / fine.worldCell - fine.firstRow
            if (c < 0 || r < 0 || c + 1 >= fine.columns || r + 1 >= fine.rows) {
              continue
            }
            const average = [0, 0, 0]
            for (const offset of [0, 1, fine.columns, fine.columns + 1]) {
              const at = (r * fine.columns + c + offset) * 4
              for (let channel = 0; channel < 3; channel++) {
                average[channel]! += a[at + channel]! / 4
              }
            }
            const at = (row * coarse.columns + column) * 4
            const error = deltaE(average as unknown as Rgb, [b[at]!, b[at + 1]!, b[at + 2]!])
            const d = Math.min(
              ...windows.map(frame =>
                distance(wx + coarse.worldCell / 2, wy + coarse.worldCell / 2, frame),
              ),
            )
            if (d > coarse.worldCell * 2) {
              open.push(error)
            } else if (d > 0) {
              band.push(error)
            }
          }
        }
        const result = { appearance, boundary, open: stats(open), band: stats(band) }
        expect(result.open.mean).toBeLessThanOrEqual(1.5)
        expect(result.open.p99).toBeLessThanOrEqual(4)
      })
    }
  }

  it('keeps the dark work light visible 30 screen px outside a frame at 10% zoom', () => {
    const grid = resolveWallGrid({ x: 0, y: 0, zoom: 0.1, width: 960, height: 720 })
    const black: Rgb = [0, 0, 0]
    const palette = {
      appearance: 'dark' as const,
      spot: [0, 176, 213] as const,
      cell: black,
      gap: black,
      clouds: [black, black, black, black],
      sparks: [black, black, black, black],
    }
    // Probe a cell centre exactly 300 world px outside the right edge, beyond the glass band.
    const x = 6.5 * grid.worldCell
    const frame = {
      x: 0,
      y: 0,
      width: x - 300,
      height: 720,
      light: { color: [255, 255, 255] as Rgb, intensity: 0.8 },
    }
    const without = fillWallCells(grid, palette, null)
    const lit = fillWallCells(grid, palette, null, { windows: [frame] })
    const at = (grid.columns + 6) * 4
    expect((lit[at]! - without[at]!) / (255 * 0.62 * 0.8)).toBeGreaterThanOrEqual(0.25)
  })
})
