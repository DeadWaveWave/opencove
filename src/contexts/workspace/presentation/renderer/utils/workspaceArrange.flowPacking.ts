export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface FlowItem {
  id: string
  width: number
  height: number
}

export function snapDown(value: number, grid: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }

  const safeGrid = Number.isFinite(grid) && grid > 0 ? grid : 1
  return Math.floor(value / safeGrid) * safeGrid
}

export function stableRectSort(
  left: { id: string; rect: Rect },
  right: { id: string; rect: Rect },
): number {
  if (left.rect.y !== right.rect.y) {
    return left.rect.y - right.rect.y
  }

  if (left.rect.x !== right.rect.x) {
    return left.rect.x - right.rect.x
  }

  return left.id.localeCompare(right.id)
}

export function computeBoundingRect(rects: Rect[]): Rect | null {
  if (rects.length === 0) {
    return null
  }

  let minX = rects[0]!.x
  let minY = rects[0]!.y
  let maxX = rects[0]!.x + rects[0]!.width
  let maxY = rects[0]!.y + rects[0]!.height

  for (const rect of rects.slice(1)) {
    minX = Math.min(minX, rect.x)
    minY = Math.min(minY, rect.y)
    maxX = Math.max(maxX, rect.x + rect.width)
    maxY = Math.max(maxY, rect.y + rect.height)
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  }
}

export function resolveFlowPacking({
  items,
  start,
  wrapWidth,
  gap,
}: {
  items: FlowItem[]
  start: { x: number; y: number }
  wrapWidth: number
  gap: number
}): Map<string, { x: number; y: number }> {
  const placements = new Map<string, { x: number; y: number }>()
  if (items.length === 0) {
    return placements
  }

  const maxItemWidth = Math.max(...items.map(item => item.width))
  const effectiveWrapWidth = Math.max(maxItemWidth, wrapWidth)
  const rowStartX = start.x
  const maxX = rowStartX + effectiveWrapWidth

  let cursorX = rowStartX
  let cursorY = start.y
  let rowHeight = 0

  for (const item of items) {
    if (cursorX !== rowStartX && cursorX + item.width > maxX) {
      cursorX = rowStartX
      cursorY += rowHeight + gap
      rowHeight = 0
    }

    placements.set(item.id, { x: cursorX, y: cursorY })
    cursorX += item.width + gap
    rowHeight = Math.max(rowHeight, item.height)
  }

  return placements
}

function rectsOverlap(left: Rect, right: Rect): boolean {
  return !(
    left.x + left.width <= right.x ||
    left.x >= right.x + right.width ||
    left.y + left.height <= right.y ||
    left.y >= right.y + right.height
  )
}

function sortPoints(points: Array<{ x: number; y: number }>): Array<{ x: number; y: number }> {
  return [...points].sort((left, right) => {
    if (left.y !== right.y) {
      return left.y - right.y
    }

    return left.x - right.x
  })
}

export function resolveDensePacking({
  items,
  start,
  wrapWidth,
  gap = 0,
}: {
  items: FlowItem[]
  start: { x: number; y: number }
  wrapWidth: number
  gap?: number
}): Map<string, { x: number; y: number }> {
  const placements = new Map<string, { x: number; y: number }>()
  if (items.length === 0) {
    return placements
  }

  const maxItemWidth = Math.max(...items.map(item => item.width))
  const effectiveWrapWidth = Math.max(maxItemWidth, wrapWidth)
  const safeGap = Number.isFinite(gap) ? Math.max(0, gap) : 0
  const maxX = start.x + effectiveWrapWidth + safeGap

  const placedRects: Rect[] = []
  const candidatePoints: Array<{ x: number; y: number }> = [{ x: start.x, y: start.y }]

  for (const item of items) {
    let placed: { x: number; y: number } | null = null
    const placementWidth = item.width + safeGap
    const placementHeight = item.height + safeGap

    for (const point of sortPoints(candidatePoints)) {
      if (point.x + placementWidth > maxX) {
        continue
      }

      const rect: Rect = {
        x: point.x,
        y: point.y,
        width: placementWidth,
        height: placementHeight,
      }
      if (placedRects.some(existing => rectsOverlap(rect, existing))) {
        continue
      }

      placed = { x: point.x, y: point.y }
      placedRects.push(rect)
      placements.set(item.id, placed)
      candidatePoints.push({ x: rect.x + rect.width, y: rect.y })
      candidatePoints.push({ x: rect.x, y: rect.y + rect.height })
      break
    }

    if (placed) {
      continue
    }

    const maxBottom = placedRects.reduce(
      (acc, rect) => Math.max(acc, rect.y + rect.height),
      start.y,
    )
    const fallback: Rect = {
      x: start.x,
      y: maxBottom,
      width: placementWidth,
      height: placementHeight,
    }
    placedRects.push(fallback)
    placements.set(item.id, { x: fallback.x, y: fallback.y })
    candidatePoints.push({ x: fallback.x + fallback.width, y: fallback.y })
    candidatePoints.push({ x: fallback.x, y: fallback.y + fallback.height })
  }

  return placements
}

export function resolveBoundedFlowPacking({
  items,
  bounds,
  gap,
}: {
  items: FlowItem[]
  bounds: Rect
  gap: number
}): Map<string, { x: number; y: number }> | null {
  if (items.length === 0) {
    return new Map()
  }

  if (bounds.width <= 0 || bounds.height <= 0) {
    return null
  }

  const rowStartX = bounds.x
  const maxX = bounds.x + bounds.width
  const maxY = bounds.y + bounds.height

  let cursorX = rowStartX
  let cursorY = bounds.y
  let rowHeight = 0

  const placements = new Map<string, { x: number; y: number }>()

  for (const item of items) {
    if (item.width > bounds.width || item.height > bounds.height) {
      return null
    }

    if (cursorX !== rowStartX && cursorX + item.width > maxX) {
      cursorX = rowStartX
      cursorY += rowHeight + gap
      rowHeight = 0
    }

    if (cursorY + item.height > maxY) {
      return null
    }

    placements.set(item.id, { x: cursorX, y: cursorY })
    cursorX += item.width + gap
    rowHeight = Math.max(rowHeight, item.height)
  }

  return placements
}
