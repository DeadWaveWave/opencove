import { describe, expect, it } from 'vitest'
import { resolveWallGrid } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/pixelWall/wallGrid'
import {
  createWallDissolve,
  WALL_DISSOLVE_MS,
} from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/pixelWall/wallDissolve'

function solid(grid: ReturnType<typeof resolveWallGrid>, value: number) {
  const cells = new Uint8ClampedArray(grid.columns * grid.rows * 4)
  for (let index = 0; index < cells.length; index += 4) {
    cells.set([value, value, value, 255], index)
  }
  return cells
}

function shareOf(cells: Uint8ClampedArray, value: number) {
  let matching = 0
  for (let index = 0; index < cells.length; index += 4) {
    if (cells[index] === value) {
      matching++
    }
  }
  return matching / (cells.length / 4)
}

// The same world region (800 × 600) at zoom 1 with 24 px cells, then at zoom 0.5 with 48 world
// px cells. Cells outside the old view have nothing to dissolve from and simply appear.
const fine = resolveWallGrid({ x: 0, y: 0, width: 800, height: 600, zoom: 1 })
const coarse = resolveWallGrid({ x: 0, y: 0, width: 400, height: 300, zoom: 0.5 })

describe('pixel wall cell dissolve', () => {
  it('passes cells through while the cell size stays the same', () => {
    const dissolve = createWallDissolve()
    const first = solid(fine, 10)
    expect(dissolve.apply(fine, first, 0)).toEqual({ cells: first, animating: false })
    const next = solid(fine, 20)
    expect(dissolve.apply(fine, next, 16).cells).toBe(next)
  })

  it('dissolves pixel by pixel from the old cells to the new over 120ms', () => {
    expect(coarse.worldCell).not.toBe(fine.worldCell)
    const dissolve = createWallDissolve()
    dissolve.apply(fine, solid(fine, 10), 0)
    let previous = -1
    for (let elapsed = 0; elapsed <= WALL_DISSOLVE_MS; elapsed += 20) {
      const { cells, animating } = dissolve.apply(coarse, solid(coarse, 200), 100 + elapsed)
      const share = shareOf(cells, 200)
      // The new cells only ever spread, and old ones show the old colour where they were.
      expect(share).toBeGreaterThanOrEqual(previous)
      expect(share + shareOf(cells, 10)).toBeCloseTo(1)
      previous = share
      expect(animating).toBe(elapsed < WALL_DISSOLVE_MS)
    }
    // A fresh step: none at the start, about half midway, all at the end.
    const again = createWallDissolve()
    again.apply(fine, solid(fine, 10), 0)
    expect(shareOf(again.apply(coarse, solid(coarse, 200), 100).cells, 200)).toBeLessThan(0.1)
    const midway = shareOf(again.apply(coarse, solid(coarse, 200), 160).cells, 200)
    expect(midway).toBeGreaterThan(0.2)
    expect(midway).toBeLessThan(0.8)
    expect(shareOf(again.apply(coarse, solid(coarse, 200), 221).cells, 200)).toBe(1)
  })

  it('switches at once without a clock (reduced motion)', () => {
    const dissolve = createWallDissolve()
    dissolve.apply(fine, solid(fine, 10), null)
    const { cells, animating } = dissolve.apply(coarse, solid(coarse, 200), null)
    expect(shareOf(cells, 200)).toBe(1)
    expect(animating).toBe(false)
  })

  it('never writes into the caller’s buffer', () => {
    const dissolve = createWallDissolve()
    dissolve.apply(fine, solid(fine, 10), 0)
    const next = solid(coarse, 200)
    dissolve.apply(coarse, next, 140)
    expect(shareOf(next, 200)).toBe(1)
  })
})
