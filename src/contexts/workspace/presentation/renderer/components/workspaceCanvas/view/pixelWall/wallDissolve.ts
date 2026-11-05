import type { WallGrid } from './wallGrid'

/** How long a change of cell size takes to dissolve (Tide: 120ms pixel dissolve). */
export const WALL_DISSOLVE_MS = 120

function threshold(column: number, row: number, worldCell: number): number {
  let h = (Math.imul(column, 2246822519) ^ Math.imul(row, 3266489917) ^ worldCell) | 0
  h = Math.imul(h ^ (h >>> 15), 668265263)
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296
}

/**
 * When the zoom crosses a cell-size step the wall would jump. Instead each new cell flips from
 * the colour the old grid had at its centre to its own colour at its own moment within 120ms.
 * Without a clock (reduced motion, a still wall) the new size shows at once.
 */
export function createWallDissolve(durationMs = WALL_DISSOLVE_MS) {
  let lastGrid: WallGrid | null = null
  let lastCells = new Uint8ClampedArray(0)
  let from: { grid: WallGrid; cells: Uint8ClampedArray; startedAt: number } | null = null
  let mixed = new Uint8ClampedArray(0)

  return {
    /** Returns the cells to draw; never writes into `cells`. */
    apply(
      grid: WallGrid,
      cells: Uint8ClampedArray,
      now: number | null,
    ): { cells: Uint8ClampedArray; animating: boolean } {
      if (lastGrid && grid.worldCell !== lastGrid.worldCell) {
        from = now === null ? null : { grid: lastGrid, cells: lastCells.slice(), startedAt: now }
      }
      lastGrid = grid
      if (lastCells.length !== cells.length) {
        lastCells = new Uint8ClampedArray(cells.length)
      }
      lastCells.set(cells)
      const progress = from && now !== null ? (now - from.startedAt) / durationMs : 1
      if (!from || progress >= 1) {
        from = null
        return { cells, animating: false }
      }
      if (mixed.length !== cells.length) {
        mixed = new Uint8ClampedArray(cells.length)
      }
      mixed.set(cells)
      const old = from
      for (let row = 0; row < grid.rows; row++) {
        const worldRow = grid.firstRow + row
        const oldRow =
          Math.floor(((worldRow + 0.5) * grid.worldCell) / old.grid.worldCell) - old.grid.firstRow
        if (oldRow < 0 || oldRow >= old.grid.rows) {
          continue
        }
        for (let column = 0; column < grid.columns; column++) {
          const worldColumn = grid.firstColumn + column
          if (threshold(worldColumn, worldRow, grid.worldCell) < progress) {
            continue
          }
          const oldColumn =
            Math.floor(((worldColumn + 0.5) * grid.worldCell) / old.grid.worldCell) -
            old.grid.firstColumn
          if (oldColumn < 0 || oldColumn >= old.grid.columns) {
            continue
          }
          const target = (row * grid.columns + column) * 4
          const source = (oldRow * old.grid.columns + oldColumn) * 4
          mixed[target] = old.cells[source]!
          mixed[target + 1] = old.cells[source + 1]!
          mixed[target + 2] = old.cells[source + 2]!
        }
      }
      return { cells: mixed, animating: true }
    },
  }
}
