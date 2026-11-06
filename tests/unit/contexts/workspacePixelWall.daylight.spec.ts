import { describe, expect, it } from 'vitest'
import { PIXEL_WALL } from '../../../src/shared/design/themeGenerator'
import { fillWallCells } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/pixelWall/wallCells'
import { resolveWallGrid } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/pixelWall/wallGrid'
import type { WallPalette } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/pixelWall/wallPalette'

const base = [160, 160, 160] as const
const plain: WallPalette = {
  appearance: 'light',
  cell: base,
  gap: base,
  clouds: [base, base, base, base],
  sparks: [base, base, base, base],
}
const hash = (x: number, y: number) => {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

describe('Tide daylight wall', () => {
  it('casts the patch by each frame size with the daylight Gaussian, across a far level boundary', () => {
    for (const zoom of [1, (13 / 96) * 1.00001, (13 / 96) * 0.99999]) {
      const grid = resolveWallGrid({ x: 0, y: 0, zoom, width: 1440, height: 900 })
      const frame = { x: 240, y: 120, width: 2400, height: 360 }
      const noLight = fillWallCells(grid, plain, null, { windows: [frame] })
      const lit = fillWallCells(grid, plain, null, {
        windows: [{ ...frame, light: { color: [250, 80, 120], intensity: 0.5 } }],
      })
      let checked = 0
      for (let row = 0; row < grid.rows; row++) {
        for (let column = 0; column < grid.columns; column++) {
          const wx = (column + 0.5) * grid.worldCell
          const wy = (row + 0.5) * grid.worldCell
          const dx = Math.max(
            frame.x + 0.09 * frame.width + 30 - wx,
            0,
            wx - frame.x - frame.width - 0.09 * frame.width - 30,
          )
          const dy = Math.max(
            frame.y + 0.12 * frame.height + 44 - wy,
            0,
            wy - frame.y - frame.height - 0.12 * frame.height - 44,
          )
          const fall = Math.max(30, (0.7 * 19.5) / zoom)
          const k = 0.5 * PIXEL_WALL.light.workA * Math.exp(-(dx * dx + dy * dy) / (fall * fall))
          // Outside the original frame's glass mask: no cap can obscure the optics.
          const d = Math.hypot(
            Math.max(frame.x - wx, 0, wx - frame.x - frame.width),
            Math.max(frame.y - wy, 0, wy - frame.y - frame.height),
          )
          if (d <= 2 * grid.worldCell || k < 0.01) {
            continue
          }
          const at = (row * grid.columns + column) * 4
          expect(lit[at]!).toBeCloseTo(Math.round(noLight[at]! + (250 - noLight[at]!) * k), 0)
          checked++
        }
      }
      expect(checked).toBeGreaterThan(0)
    }
  })

  it('uses viewport dimensions for the top-left daylight gradient, leaving dark unchanged', () => {
    const grid = resolveWallGrid({ x: -7, y: -13, zoom: 1, width: 973, height: 713 })
    // Compare a fixed world cell between differently sized viewports. Cloud/jitter are identical.
    const larger = resolveWallGrid({ x: -7, y: -13, zoom: 1, width: 1946, height: 1426 })
    for (const appearance of ['dark', 'light'] as const) {
      const a = fillWallCells(grid, { ...plain, appearance }, null)
      const b = fillWallCells(larger, { ...plain, appearance }, null)
      const row = 20,
        column = 30
      const change = b[(row * larger.columns + column) * 4]! - a[(row * grid.columns + column) * 4]!
      if (appearance === 'light') {
        // Cloud and shimmer mixing attenuate the 5.4-channel input gradient difference.
        expect(change).toBeGreaterThanOrEqual(2)
      } else {
        expect(change).toBe(0)
      }
    }
  })

  it('flashes white for hh > 0.95 in daylight, with 0.9 strength (dark stays at 0.85)', () => {
    const grid = resolveWallGrid({ x: 0, y: 0, zoom: 1, width: 960, height: 720 })
    for (const appearance of ['dark', 'light'] as const) {
      let count = 0
      for (let row = 0; row < grid.rows; row++) {
        for (let column = 0; column < grid.columns; column++) {
          const hh = hash(column * 7, row * 13)
          if (hh <= 0.95) {
            continue
          }
          const time = (Math.PI / 2 + 16 * Math.PI - hh * 50) / (0.6 + hh * 1.6)
          const p = { ...plain, appearance }
          const cells = fillWallCells(grid, p, time)
          const value = cells[(row * grid.columns + column) * 4]!
          if (appearance === 'light') {
            expect(value).toBeGreaterThan(242)
          } else {
            expect(value).toBeLessThan(165)
          }
          count++
        }
      }
      expect(count).toBeGreaterThan(20)
    }
  })
})
