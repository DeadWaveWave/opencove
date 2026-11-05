import { describe, expect, it } from 'vitest'
import { PIXEL_WALL } from '../../../src/shared/design/themeGenerator'
import { resolveWallGrid } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/pixelWall/wallGrid'
import { fillWallCells } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/pixelWall/wallCells'
import type { WallPalette } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/pixelWall/wallPalette'

const base: [number, number, number] = [17, 24, 30]
// Four very different cloud colours, so a jump between them is unmistakable.
const vivid: WallPalette = {
  appearance: 'dark',
  cell: base,
  gap: [5, 9, 12],
  clouds: [
    [255, 0, 0],
    [0, 255, 0],
    [0, 0, 255],
    [255, 255, 0],
  ],
  sparks: [
    [255, 255, 255],
    [255, 255, 255],
    [255, 255, 255],
    [255, 255, 255],
  ],
  spot: [255, 255, 255],
}
// No clouds at all: whatever moves a cell is shimmer, twinkle or the spotlight.
const plain: WallPalette = { ...vivid, clouds: vivid.clouds.map(() => base) }

const grid = resolveWallGrid({ x: 0, y: 0, zoom: 1, width: 1920, height: 1200 })
const cellAt = (cells: Uint8ClampedArray, column: number, row: number) => {
  const at = (row * grid.columns + column) * 4
  return [cells[at]!, cells[at + 1]!, cells[at + 2]!]
}
const lift = (cells: Uint8ClampedArray, column: number, row: number) =>
  Math.max(...cellAt(cells, column, row).map((value, channel) => value - base[channel]!))

describe('pixel wall clouds', () => {
  it('blend from one cloud colour into the next instead of switching at a hard edge', () => {
    const cells = fillWallCells(grid, vivid, null)
    let steepest = 0
    for (let row = 0; row < grid.rows; row++) {
      for (let column = 1; column < grid.columns; column++) {
        const a = cellAt(cells, column - 1, row)
        const b = cellAt(cells, column, row)
        steepest = Math.max(steepest, ...a.map((value, channel) => Math.abs(value - b[channel]!)))
      }
    }
    // A switch between two of these colours at cloud strength moves a channel by over 100.
    expect(steepest).toBeLessThan(48)
  })
})

describe('pixel wall shimmer', () => {
  it('brightens wandering patches of open wall, even on a still wall', () => {
    const cells = fillWallCells(grid, plain, null)
    let brightest = 0
    for (let row = 0; row < grid.rows; row++) {
      for (let column = 0; column < grid.columns; column++) {
        brightest = Math.max(brightest, lift(cells, column, row))
      }
    }
    expect(brightest).toBeGreaterThan(20)
    expect(brightest).toBeLessThanOrEqual(255 * PIXEL_WALL.dark.shimmerA + 8)
  })

  it('moves with time', () => {
    expect(fillWallCells(grid, plain, 12)).not.toEqual(fillWallCells(grid, plain, 0))
  })

  it('stays out of the glass behind a window', () => {
    const glass = { x: 0, y: 0, width: 1920, height: 1200 }
    const cells = fillWallCells(grid, plain, 3.3, { windows: [glass] })
    for (let row = 0; row < grid.rows; row++) {
      for (let column = 0; column < grid.columns; column++) {
        expect(lift(cells, column, row)).toBeLessThan(8)
      }
    }
  })
})

describe('pixel wall twinkle near active windows', () => {
  it('twinkles more densely around a working or waiting window', () => {
    const window = {
      x: 600,
      y: 360,
      width: 480,
      height: 360,
      light: { color: base, intensity: 0 },
      active: true,
    }
    const twinkled = new Set<number>()
    for (let step = 0; step < 90; step++) {
      // Shimmer is static between these frames' noise inputs only roughly, so count cells that
      // flash well above anything shimmer reaches.
      const cells = fillWallCells(grid, plain, step * 0.41, { windows: [window] })
      for (let cell = 0; cell < grid.columns * grid.rows; cell++) {
        if (lift(cells, cell % grid.columns, Math.floor(cell / grid.columns)) > 120) {
          twinkled.add(cell)
        }
      }
    }
    const share = (test: (distance: number) => boolean) => {
      let hit = 0
      let total = 0
      for (let cell = 0; cell < grid.columns * grid.rows; cell++) {
        const cx = ((cell % grid.columns) + 0.5) * grid.worldCell
        const cy = (Math.floor(cell / grid.columns) + 0.5) * grid.worldCell
        const dx = Math.max(window.x - cx, 0, cx - (window.x + window.width))
        const dy = Math.max(window.y - cy, 0, cy - (window.y + window.height))
        if (test(Math.hypot(dx, dy))) {
          total++
          if (twinkled.has(cell)) {
            hit++
          }
        }
      }
      return hit / total
    }
    const near = share(distance => distance > 3 * grid.worldCell && distance < 120)
    const far = share(distance => distance > 400)
    expect(near).toBeGreaterThan(far * 1.3)
  })
})

describe('pixel wall cursor spotlight', () => {
  const spot = { x: 960, y: 600 }
  const column = Math.floor(spot.x / grid.screenCell)
  const row = Math.floor(spot.y / grid.screenCell)

  it('brightens the open wall around the pointer a little', () => {
    const without = fillWallCells(grid, plain, null)
    const lit = fillWallCells(grid, plain, null, { spot })
    const gain = lift(lit, column, row) - lift(without, column, row)
    expect(gain).toBeGreaterThan(20)
    expect(gain).toBeLessThanOrEqual(255 * PIXEL_WALL.dark.spotA + 2)
    // Far from the pointer nothing changes.
    expect(cellAt(lit, 2, 2)).toEqual(cellAt(without, 2, 2))
  })

  it('never lights the glass behind a window', () => {
    const glass = { x: 800, y: 480, width: 320, height: 240 }
    const cells = fillWallCells(grid, plain, null, { windows: [glass], spot })
    expect(lift(cells, column, row)).toBeLessThan(8)
  })
})

describe('pixel wall in far view', () => {
  const near = resolveWallGrid({ x: 0, y: 0, zoom: 0.9, width: 1920, height: 1200 })
  const far = resolveWallGrid({ x: 0, y: 0, zoom: 0.18, width: 1920, height: 1200 })
  const roughness = (view: typeof grid, cells: Uint8ClampedArray) => {
    let total = 0
    let pairs = 0
    for (let row = 0; row < view.rows; row++) {
      for (let column = 1; column < view.columns; column++) {
        const a = (row * view.columns + column - 1) * 4
        const b = a + 4
        total += Math.abs(cells[a]! - cells[b]!) + Math.abs(cells[a + 1]! - cells[b + 1]!)
        pairs++
      }
    }
    return total / pairs
  }

  it('keeps clouds as broad on screen as in near view, so the zoomed-out wall stays calm', () => {
    expect(far.worldCell).toBeGreaterThan(near.worldCell)
    const calm = { ...vivid, sparks: vivid.sparks.map(() => base) }
    expect(roughness(far, fillWallCells(far, calm, null))).toBeLessThan(
      roughness(near, fillWallCells(near, calm, null)) * 1.25,
    )
  })

  it('twinkles more sparsely per cell when each cell covers more of the canvas', () => {
    const flashes = (view: typeof grid) => {
      const lit = new Set<number>()
      for (let step = 0; step < 60; step++) {
        const cells = fillWallCells(view, plain, step * 0.41)
        for (let cell = 0; cell < view.columns * view.rows; cell++) {
          if (cells[cell * 4]! - base[0] > 120) {
            lit.add(cell)
          }
        }
      }
      return lit.size / (view.columns * view.rows)
    }
    expect(flashes(far)).toBeLessThan(flashes(near) * 0.75)
  })
})
