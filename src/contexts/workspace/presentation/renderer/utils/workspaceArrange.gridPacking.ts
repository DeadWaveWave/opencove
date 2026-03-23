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

export interface GridOccupiedRegion extends GridPlacement {
  colSpan: number
  rowSpan: number
}

export interface DenseGridPackingResult {
  placements: Map<string, GridPlacement>
  columnsUsed: number
  rowsUsed: number
}

interface DenseGridCandidate {
  placements: DenseGridPackingResult
  area: number
  aspectPenalty: number
  width: number
  height: number
}

const COMPACT_AREA_TOLERANCE = 1.25

function createEmptyGridRow(columnCount: number): boolean[] {
  return Array.from({ length: columnCount }, () => false)
}

function resolveAspectPenalty(aspect: number, targetAspect: number): number {
  if (!Number.isFinite(aspect) || aspect <= 0) {
    return Number.POSITIVE_INFINITY
  }

  if (!Number.isFinite(targetAspect) || targetAspect <= 0) {
    return 0
  }

  return Math.abs(Math.log(aspect / targetAspect))
}

export function resolveDenseGridAutoPlacement({
  items,
  columnCount,
  occupiedRegions = [],
}: {
  items: GridItem[]
  columnCount: number
  occupiedRegions?: GridOccupiedRegion[]
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

  for (const region of occupiedRegions) {
    const colSpan = Math.max(1, Math.floor(region.colSpan))
    const rowSpan = Math.max(1, Math.floor(region.rowSpan))
    const col = Math.max(0, Math.floor(region.col))
    const row = Math.max(0, Math.floor(region.row))

    if (col + colSpan > safeColumnCount) {
      throw new Error(`Occupied region exceeds columnCount (${col + colSpan} > ${safeColumnCount})`)
    }

    occupyRegion({ col, row, colSpan, rowSpan })
    columnsUsed = Math.max(columnsUsed, col + colSpan)
    rowsUsed = Math.max(rowsUsed, row + rowSpan)
  }

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
  gap = 0,
  targetAspect,
  maxColumns,
  maxHeight,
  compactAreaTolerance = COMPACT_AREA_TOLERANCE,
}: {
  items: GridItem[]
  start: { x: number; y: number }
  cell: { width: number; height: number }
  gap?: number
  targetAspect: number
  maxColumns?: number
  maxHeight?: number
  compactAreaTolerance?: number
}): { placements: Map<string, { x: number; y: number }>; bounding: Rect } | null {
  if (items.length === 0) {
    return { placements: new Map(), bounding: { x: start.x, y: start.y, width: 0, height: 0 } }
  }

  const safeCellWidth = Number.isFinite(cell.width) && cell.width > 0 ? Math.floor(cell.width) : 1
  const safeCellHeight =
    Number.isFinite(cell.height) && cell.height > 0 ? Math.floor(cell.height) : 1
  const safeGap = Number.isFinite(gap) ? Math.max(0, Math.floor(gap)) : 0
  const safeAspect = Number.isFinite(targetAspect) && targetAspect > 0 ? targetAspect : 16 / 9
  const safeCompactAreaTolerance =
    Number.isFinite(compactAreaTolerance) && compactAreaTolerance >= 1
      ? compactAreaTolerance
      : COMPACT_AREA_TOLERANCE

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

    const strideWidth = safeCellWidth + safeGap
    const strideHeight = safeCellHeight + safeGap
    const estimated = Math.sqrt(areaCells * safeAspect * (strideHeight / strideWidth))
    return Math.max(minColumns, Math.min(maxColumnsLimit, Math.round(estimated)))
  })()

  const columnCandidates = new Set<number>()
  const addCandidate = (value: number) => {
    if (!Number.isFinite(value)) {
      return
    }

    const snapped = Math.max(minColumns, Math.min(maxColumnsLimit, Math.round(value)))
    columnCandidates.add(snapped)
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

  const sortedCandidates = [...columnCandidates].sort((a, b) => a - b)

  const candidates: DenseGridCandidate[] = []

  for (const columnCount of sortedCandidates) {
    if (columnCount < minColumns) {
      continue
    }

    const gridPlacement = resolveDenseGridAutoPlacement({ items, columnCount })
    const width =
      gridPlacement.columnsUsed > 0
        ? gridPlacement.columnsUsed * safeCellWidth + (gridPlacement.columnsUsed - 1) * safeGap
        : 0
    const height =
      gridPlacement.rowsUsed > 0
        ? gridPlacement.rowsUsed * safeCellHeight + (gridPlacement.rowsUsed - 1) * safeGap
        : 0

    if (typeof maxHeight === 'number' && Number.isFinite(maxHeight) && maxHeight >= 0) {
      if (height > maxHeight) {
        continue
      }
    }

    candidates.push({
      placements: gridPlacement,
      area: width * height,
      aspectPenalty: resolveAspectPenalty(
        height > 0 ? width / height : Number.POSITIVE_INFINITY,
        safeAspect,
      ),
      width,
      height,
    })
  }

  const minArea = Math.min(...candidates.map(candidate => candidate.area))
  const compactCandidates = candidates.filter(
    candidate => candidate.area <= minArea * safeCompactAreaTolerance,
  )
  const rankedCandidates = compactCandidates.length > 0 ? compactCandidates : candidates
  const best =
    rankedCandidates.sort((left, right) => {
      if (left.aspectPenalty !== right.aspectPenalty) {
        return left.aspectPenalty - right.aspectPenalty
      }

      if (left.height !== right.height) {
        return left.height - right.height
      }

      if (left.area !== right.area) {
        return left.area - right.area
      }

      return left.width - right.width
    })[0] ?? null

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
      x: start.x + placed.col * (safeCellWidth + safeGap),
      y: start.y + placed.row * (safeCellHeight + safeGap),
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
