import { describe, expect, it } from 'vitest'
import {
  resolveWallCellSize,
  resolveWallGrid,
  WALL_MAX_SCREEN_CELL,
  WALL_MIN_SCREEN_CELL,
  WALL_WORLD_CELL,
} from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/pixelWall/wallGrid'

describe('pixel wall grid', () => {
  it.each([0.02, 0.1, 0.25, 0.28, 0.5, 0.54, 1, 1.08, 2, 4])(
    'keeps cells between 13 and 26 screen px at zoom %f, in powers of two of 24 world px',
    zoom => {
      const worldCell = resolveWallCellSize(zoom)
      const screen = worldCell * zoom
      expect(screen).toBeGreaterThanOrEqual(WALL_MIN_SCREEN_CELL)
      expect(screen).toBeLessThan(WALL_MAX_SCREEN_CELL)
      expect(Number.isInteger(Math.log2(worldCell / WALL_WORLD_CELL))).toBe(true)
    },
  )

  it('falls back to the base cell for a zoom that cannot be drawn', () => {
    expect(resolveWallCellSize(0)).toBe(WALL_WORLD_CELL)
    expect(resolveWallCellSize(Number.NaN)).toBe(WALL_WORLD_CELL)
  })

  it('covers the whole viewport, starting at or before its top left corner', () => {
    const grid = resolveWallGrid({ x: -137, y: 55, zoom: 0.8, width: 1440, height: 900 })
    expect(grid.originX).toBeLessThanOrEqual(0)
    expect(grid.originX).toBeGreaterThan(-grid.screenCell)
    expect(grid.originY).toBeLessThanOrEqual(0)
    expect(grid.originX + grid.columns * grid.screenCell).toBeGreaterThanOrEqual(1440)
    expect(grid.originY + grid.rows * grid.screenCell).toBeGreaterThanOrEqual(900)
  })

  it('anchors cells to the world, so panning by a cell shifts the indices, not the cells', () => {
    const at = resolveWallGrid({ x: 0, y: 0, zoom: 1, width: 400, height: 300 })
    const panned = resolveWallGrid({
      x: -at.screenCell,
      y: 0,
      zoom: 1,
      width: 400,
      height: 300,
    })
    expect(panned.firstColumn).toBe(at.firstColumn + 1)
    expect(panned.originX).toBeCloseTo(at.originX)
  })

  it('keeps a hairline gap that grows with the cell but never hides it', () => {
    const small = resolveWallGrid({ x: 0, y: 0, zoom: 0.55, width: 100, height: 100 })
    const large = resolveWallGrid({ x: 0, y: 0, zoom: 1.05, width: 100, height: 100 })
    expect(small.gap).toBeGreaterThanOrEqual(1)
    expect(large.gap).toBeGreaterThanOrEqual(small.gap)
    expect(large.gap).toBeLessThanOrEqual(3)
  })

  it('returns an empty grid for an empty viewport', () => {
    const grid = resolveWallGrid({ x: 0, y: 0, zoom: 1, width: 0, height: 0 })
    expect(grid.columns * grid.rows).toBe(0)
  })
})
