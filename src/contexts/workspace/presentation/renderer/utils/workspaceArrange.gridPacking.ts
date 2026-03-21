import type { Rect } from './workspaceArrange.flowPacking'

export interface GridItem {
  id: string
  colSpan: number
  rowSpan: number
}

export interface GridPlacement {
  col: number
  row: number
}

export interface DenseGridPackingResult {
  placements: Map<string, GridPlacement>
  columnsUsed: number
  rowsUsed: number
}

function createEmptyGridRow(columnCount: number): boolean[] {
  return Array.from({ length: columnCount }, () => false)
}

export function resolveDenseGridAutoPlacement({
  items,
  columnCount,
}: {
  items: GridItem[]
  columnCount: number
}): DenseGridPackingResult {
  const placements = new Map<string, GridPlacement>()
  if (items.length === 0) {
    return { placements, columnsUsed: 0, rowsUsed: 0 }
  }

  const safeColumnCount = Number.isFinite(columnCount) ? Math.max(1, Math.floor(columnCount)) : 1
  const grid: boolean[][] = []

  const ensureRow = (rowIndex: number): boolean[] => {
    while (grid.length <= rowIndex) {
      grid.push(createEmptyGridRow(safeColumnCount))
    }
    return grid[rowIndex]!
  }

  const isRegionFree = ({
    col,
    row,
    colSpan,
    rowSpan,
  }: {
    col: number
    row: number
    colSpan: number
    rowSpan: number
  }): boolean => {
    for (let r = row; r < row + rowSpan; r += 1) {
      const rowCells = ensureRow(r)
      for (let c = col; c < col + colSpan; c += 1) {
        if (rowCells[c]) {
          return false
        }
      }
    }
    return true
  }

  const occupyRegion = ({
    col,
    row,
    colSpan,
    rowSpan,
  }: {
    col: number
    row: number
    colSpan: number
    rowSpan: number
  }) => {
    for (let r = row; r < row + rowSpan; r += 1) {
      const rowCells = ensureRow(r)
      for (let c = col; c < col + colSpan; c += 1) {
        rowCells[c] = true
      }
    }
  }

  let columnsUsed = 0
  let rowsUsed = 0

  for (const item of items) {
    const colSpan = Math.max(1, Math.floor(item.colSpan))
    const rowSpan = Math.max(1, Math.floor(item.rowSpan))
    if (colSpan > safeColumnCount) {
      throw new Error(
        `Grid item "${item.id}" is wider than columnCount (${colSpan} > ${safeColumnCount})`,
      )
    }

    let placed: GridPlacement | null = null

    for (let row = 0; placed === null; row += 1) {
      for (let col = 0; col <= safeColumnCount - colSpan; col += 1) {
        if (!isRegionFree({ col, row, colSpan, rowSpan })) {
          continue
        }

        occupyRegion({ col, row, colSpan, rowSpan })
        placed = { col, row }
        placements.set(item.id, placed)
        columnsUsed = Math.max(columnsUsed, col + colSpan)
        rowsUsed = Math.max(rowsUsed, row + rowSpan)
        break
      }
    }
  }

  return { placements, columnsUsed, rowsUsed }
}

export function resolveBestDenseGridPacking({
  items,
  start,
  cell,
  targetAspect,
  maxColumns,
  maxHeight,
}: {
  items: GridItem[]
  start: { x: number; y: number }
  cell: { width: number; height: number }
  targetAspect: number
  maxColumns?: number
  maxHeight?: number
}): { placements: Map<string, { x: number; y: number }>; bounding: Rect } | null {
  if (items.length === 0) {
    return { placements: new Map(), bounding: { x: start.x, y: start.y, width: 0, height: 0 } }
  }

  const safeCellWidth = Number.isFinite(cell.width) && cell.width > 0 ? Math.floor(cell.width) : 1
  const safeCellHeight =
    Number.isFinite(cell.height) && cell.height > 0 ? Math.floor(cell.height) : 1
  const safeAspect = Number.isFinite(targetAspect) && targetAspect > 0 ? targetAspect : 16 / 9

  const minColumns = Math.max(1, ...items.map(item => Math.max(1, Math.floor(item.colSpan))))
  const areaCells = items.reduce(
    (sum, item) =>
      sum + Math.max(1, Math.floor(item.colSpan)) * Math.max(1, Math.floor(item.rowSpan)),
    0,
  )
  const totalColSpan = items.reduce((sum, item) => sum + Math.max(1, Math.floor(item.colSpan)), 0)

  const maxColumnsLimit = (() => {
    if (typeof maxColumns === 'number' && Number.isFinite(maxColumns)) {
      return Math.max(minColumns, Math.floor(maxColumns))
    }

    return Math.max(minColumns, Math.min(64, totalColSpan))
  })()

  if (maxColumnsLimit < minColumns) {
    return null
  }

  const idealColumns = (() => {
    if (areaCells <= 0) {
      return minColumns
    }

    const estimated = Math.sqrt(areaCells * safeAspect * (safeCellHeight / safeCellWidth))
    return Math.max(minColumns, Math.min(maxColumnsLimit, Math.round(estimated)))
  })()

  const candidates = new Set<number>()
  const addCandidate = (value: number) => {
    if (!Number.isFinite(value)) {
      return
    }

    const snapped = Math.max(minColumns, Math.min(maxColumnsLimit, Math.round(value)))
    candidates.add(snapped)
  }

  addCandidate(minColumns)
  addCandidate(maxColumnsLimit)
  addCandidate(Math.floor(maxColumnsLimit / 2))

  for (let delta = -3; delta <= 3; delta += 1) {
    addCandidate(idealColumns + delta)
  }

  const sqrtArea = Math.sqrt(Math.max(1, areaCells))
  addCandidate(Math.round(sqrtArea))
  addCandidate(Math.round(sqrtArea * 1.25))
  addCandidate(Math.round(sqrtArea * 1.5))
  addCandidate(Math.round(sqrtArea * 2))

  const sortedCandidates = [...candidates].sort((a, b) => a - b)

  let best: {
    placements: DenseGridPackingResult
    area: number
    aspectDiff: number
    width: number
    height: number
  } | null = null

  for (const columnCount of sortedCandidates) {
    if (columnCount < minColumns) {
      continue
    }

    const gridPlacement = resolveDenseGridAutoPlacement({ items, columnCount })
    const width = gridPlacement.columnsUsed * safeCellWidth
    const height = gridPlacement.rowsUsed * safeCellHeight

    if (typeof maxHeight === 'number' && Number.isFinite(maxHeight) && maxHeight >= 0) {
      if (height > maxHeight) {
        continue
      }
    }

    const area = width * height
    const aspect = height > 0 ? width / height : Number.POSITIVE_INFINITY
    const aspectDiff = Number.isFinite(aspect) ? Math.abs(aspect - safeAspect) : 0

    const candidate = {
      placements: gridPlacement,
      area,
      aspectDiff,
      width,
      height,
    }

    if (!best) {
      best = candidate
      continue
    }

    if (candidate.area !== best.area) {
      if (candidate.area < best.area) {
        best = candidate
      }
      continue
    }

    if (candidate.aspectDiff !== best.aspectDiff) {
      if (candidate.aspectDiff < best.aspectDiff) {
        best = candidate
      }
      continue
    }

    if (candidate.height !== best.height) {
      if (candidate.height < best.height) {
        best = candidate
      }
      continue
    }

    if (candidate.width < best.width) {
      best = candidate
    }
  }

  if (!best) {
    return null
  }

  const pixelPlacements = new Map<string, { x: number; y: number }>()
  for (const item of items) {
    const placed = best.placements.placements.get(item.id)
    if (!placed) {
      continue
    }

    pixelPlacements.set(item.id, {
      x: start.x + placed.col * safeCellWidth,
      y: start.y + placed.row * safeCellHeight,
    })
  }

  return {
    placements: pixelPlacements,
    bounding: {
      x: start.x,
      y: start.y,
      width: best.width,
      height: best.height,
    },
  }
}
