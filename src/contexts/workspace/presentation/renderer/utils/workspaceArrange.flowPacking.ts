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

export interface SpiralBounds {
  minX?: number
  minY?: number
  maxX?: number
  maxY?: number
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

function rectsOverlapWithGap(left: Rect, right: Rect, gap: number): boolean {
  if (gap <= 0) {
    return rectsOverlap(left, right)
  }

  const halfGap = gap / 2
  return !(
    left.x + left.width + halfGap <= right.x - halfGap ||
    left.x - halfGap >= right.x + right.width + halfGap ||
    left.y + left.height + halfGap <= right.y - halfGap ||
    left.y - halfGap >= right.y + right.height + halfGap
  )
}

function isRectWithinSpiralBounds(rect: Rect, bounds?: SpiralBounds): boolean {
  if (!bounds) {
    return true
  }

  if (bounds.minX !== undefined && rect.x < bounds.minX) {
    return false
  }

  if (bounds.minY !== undefined && rect.y < bounds.minY) {
    return false
  }

  if (bounds.maxX !== undefined && rect.x + rect.width > bounds.maxX) {
    return false
  }

  if (bounds.maxY !== undefined && rect.y + rect.height > bounds.maxY) {
    return false
  }

  return true
}

function* createSquareSpiralOffsets(): Generator<{ x: number; y: number }, void> {
  let x = 0
  let y = 0
  let stepLength = 1
  let directionIndex = 0
  const directions = [
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: -1, y: 0 },
    { x: 0, y: -1 },
  ] as const

  yield { x, y }

  while (true) {
    for (let repeat = 0; repeat < 2; repeat += 1) {
      const direction = directions[directionIndex % directions.length]!
      for (let index = 0; index < stepLength; index += 1) {
        x += direction.x
        y += direction.y
        yield { x, y }
      }

      directionIndex += 1
    }

    stepLength += 1
  }
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
}: {
  items: FlowItem[]
  start: { x: number; y: number }
  wrapWidth: number
}): Map<string, { x: number; y: number }> {
  const placements = new Map<string, { x: number; y: number }>()
  if (items.length === 0) {
    return placements
  }

  const maxItemWidth = Math.max(...items.map(item => item.width))
  const effectiveWrapWidth = Math.max(maxItemWidth, wrapWidth)
  const maxX = start.x + effectiveWrapWidth

  const placedRects: Rect[] = []
  const candidatePoints: Array<{ x: number; y: number }> = [{ x: start.x, y: start.y }]

  for (const item of items) {
    let placed: { x: number; y: number } | null = null

    for (const point of sortPoints(candidatePoints)) {
      if (point.x + item.width > maxX) {
        continue
      }

      const rect: Rect = { x: point.x, y: point.y, width: item.width, height: item.height }
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
    const fallback: Rect = { x: start.x, y: maxBottom, width: item.width, height: item.height }
    placedRects.push(fallback)
    placements.set(item.id, { x: fallback.x, y: fallback.y })
    candidatePoints.push({ x: fallback.x + fallback.width, y: fallback.y })
    candidatePoints.push({ x: fallback.x, y: fallback.y + fallback.height })
  }

  return placements
}

export function resolveSpiralPacking({
  items,
  anchor,
  step,
  gap,
  bounds,
}: {
  items: FlowItem[]
  anchor: { x: number; y: number }
  step: number
  gap: number
  bounds?: SpiralBounds
}): Map<string, { x: number; y: number }> | null {
  const placements = new Map<string, { x: number; y: number }>()
  if (items.length === 0) {
    return placements
  }

  const placedRects: Rect[] = []
  const safeStep = Math.max(1, Math.round(step))
  const hardMaxRing = 4096

  for (const item of items) {
    const baseX = anchor.x - item.width / 2
    const baseY = anchor.y - item.height / 2

    const minOffsetX =
      bounds?.minX !== undefined ? Math.ceil((bounds.minX - baseX) / safeStep) : -Infinity
    const maxOffsetX =
      bounds?.maxX !== undefined
        ? Math.floor((bounds.maxX - item.width - baseX) / safeStep)
        : Infinity
    const minOffsetY =
      bounds?.minY !== undefined ? Math.ceil((bounds.minY - baseY) / safeStep) : -Infinity
    const maxOffsetY =
      bounds?.maxY !== undefined
        ? Math.floor((bounds.maxY - item.height - baseY) / safeStep)
        : Infinity

    if (minOffsetX > maxOffsetX || minOffsetY > maxOffsetY) {
      return null
    }

    const boundedMaxRing =
      Number.isFinite(minOffsetX) ||
      Number.isFinite(maxOffsetX) ||
      Number.isFinite(minOffsetY) ||
      Number.isFinite(maxOffsetY)
        ? Math.max(
            Math.abs(Number.isFinite(minOffsetX) ? minOffsetX : 0),
            Math.abs(Number.isFinite(maxOffsetX) ? maxOffsetX : 0),
            Math.abs(Number.isFinite(minOffsetY) ? minOffsetY : 0),
            Math.abs(Number.isFinite(maxOffsetY) ? maxOffsetY : 0),
          )
        : null
    const maxRing = boundedMaxRing === null ? hardMaxRing : Math.min(hardMaxRing, boundedMaxRing)

    let didPlace = false
    for (const offset of createSquareSpiralOffsets()) {
      const ring = Math.max(Math.abs(offset.x), Math.abs(offset.y))
      if (ring > maxRing) {
        break
      }

      if (
        offset.x < minOffsetX ||
        offset.x > maxOffsetX ||
        offset.y < minOffsetY ||
        offset.y > maxOffsetY
      ) {
        continue
      }

      const rect: Rect = {
        x: Math.round(baseX + offset.x * safeStep),
        y: Math.round(baseY + offset.y * safeStep),
        width: item.width,
        height: item.height,
      }

      if (!isRectWithinSpiralBounds(rect, bounds)) {
        continue
      }

      if (placedRects.some(existing => rectsOverlapWithGap(rect, existing, gap))) {
        continue
      }

      placements.set(item.id, { x: rect.x, y: rect.y })
      placedRects.push(rect)
      didPlace = true
      break
    }

    if (!didPlace) {
      return null
    }
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
