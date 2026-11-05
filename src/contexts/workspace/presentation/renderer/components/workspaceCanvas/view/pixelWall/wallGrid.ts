/** World size of one wall cell at the base level; other levels double or halve it. */
export const WALL_WORLD_CELL = 24
/** Cells stay between these screen sizes (Tide: 13–26px, in steps of two). */
export const WALL_MIN_SCREEN_CELL = 13
export const WALL_MAX_SCREEN_CELL = 26

export interface WallViewport {
  /** Screen offset of the world origin, as React Flow's transform. */
  x: number
  y: number
  zoom: number
  width: number
  height: number
}

/** The visible cells of the wall, anchored to the world so panning never slides a cell. */
export interface WallGrid {
  worldCell: number
  screenCell: number
  firstColumn: number
  firstRow: number
  columns: number
  rows: number
  /** Screen position of the first cell's top left corner, at or before the viewport's. */
  originX: number
  originY: number
  /** Width of the seam between cells, in CSS px. */
  gap: number
}

export function resolveWallCellSize(zoom: number): number {
  if (!(zoom > 0) || !Number.isFinite(zoom)) {
    return WALL_WORLD_CELL
  }
  let cell = WALL_WORLD_CELL
  // Bounded: 2^40 covers any zoom React Flow can reach.
  for (let step = 0; step < 40 && cell * zoom < WALL_MIN_SCREEN_CELL; step++) {
    cell *= 2
  }
  for (let step = 0; step < 40 && cell * zoom >= WALL_MAX_SCREEN_CELL; step++) {
    cell /= 2
  }
  return cell
}

export function resolveWallGrid(viewport: WallViewport): WallGrid {
  const worldCell = resolveWallCellSize(viewport.zoom)
  const screenCell = worldCell * (viewport.zoom > 0 ? viewport.zoom : 1)
  const width = Math.max(0, viewport.width)
  const height = Math.max(0, viewport.height)
  const firstColumn = Math.floor(-viewport.x / screenCell)
  const firstRow = Math.floor(-viewport.y / screenCell)
  const originX = firstColumn * screenCell + viewport.x
  const originY = firstRow * screenCell + viewport.y
  return {
    worldCell,
    screenCell,
    firstColumn,
    firstRow,
    columns: width > 0 && height > 0 ? Math.ceil((width - originX) / screenCell) : 0,
    rows: width > 0 && height > 0 ? Math.ceil((height - originY) / screenCell) : 0,
    originX,
    originY,
    gap: Math.max(1, Math.min(3, screenCell * 0.12)),
  }
}
