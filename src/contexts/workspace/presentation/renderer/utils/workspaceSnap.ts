export interface WorkspaceSnapRect {
  x: number
  y: number
  width: number
  height: number
}

export type WorkspaceSnapGuide =
  | { kind: 'v'; x: number; y1: number; y2: number }
  | { kind: 'h'; y: number; x1: number; x2: number }

type AxisSnapKind = 'none' | 'grid' | 'object'

interface AxisSnapResult {
  kind: AxisSnapKind
  delta: number
  guide: WorkspaceSnapGuide | null
}

export interface WorkspaceSnapResult {
  dx: number
  dy: number
  guides: WorkspaceSnapGuide[]
}

const WORKSPACE_SNAP_MAX_CANDIDATES = 96
const WORKSPACE_SNAP_SEARCH_PADDING_PX = 288

function clampGuideRange(value1: number, value2: number): { min: number; max: number } {
  const min = Math.min(value1, value2)
  const max = Math.max(value1, value2)
  return { min, max }
}

function resolveGridDelta(value: number, grid: number): number {
  if (!(grid > 0)) {
    return 0
  }

  const snapped = Math.round(value / grid) * grid
  return snapped - value
}

function rectEdges(rect: WorkspaceSnapRect) {
  const left = rect.x
  const top = rect.y
  const right = rect.x + rect.width
  const bottom = rect.y + rect.height
  const centerX = rect.x + rect.width / 2
  const centerY = rect.y + rect.height / 2

  return { left, right, centerX, top, bottom, centerY }
}

function resolveAxisDistance(leftValues: number[], rightValues: number[]): number {
  let best = Number.POSITIVE_INFINITY

  for (const leftValue of leftValues) {
    for (const rightValue of rightValues) {
      best = Math.min(best, Math.abs(leftValue - rightValue))
    }
  }

  return best
}

function intersectsExpandedRect(
  movingRect: WorkspaceSnapRect,
  candidateRect: WorkspaceSnapRect,
  padding: number,
): boolean {
  const movingLeft = movingRect.x - padding
  const movingTop = movingRect.y - padding
  const movingRight = movingRect.x + movingRect.width + padding
  const movingBottom = movingRect.y + movingRect.height + padding

  return (
    candidateRect.x <= movingRight &&
    candidateRect.x + candidateRect.width >= movingLeft &&
    candidateRect.y <= movingBottom &&
    candidateRect.y + candidateRect.height >= movingTop
  )
}

function filterSnapCandidateRects({
  movingRect,
  candidateRects,
  threshold,
}: {
  movingRect: WorkspaceSnapRect
  candidateRects: WorkspaceSnapRect[]
  threshold: number
}): WorkspaceSnapRect[] {
  if (candidateRects.length <= WORKSPACE_SNAP_MAX_CANDIDATES) {
    return candidateRects
  }

  const moving = rectEdges(movingRect)
  const maxAxisDistance = threshold + WORKSPACE_SNAP_SEARCH_PADDING_PX

  const rankedCandidates = candidateRects
    .map(candidateRect => {
      const candidate = rectEdges(candidateRect)
      const xDistance = resolveAxisDistance(
        [moving.left, moving.centerX, moving.right],
        [candidate.left, candidate.centerX, candidate.right],
      )
      const yDistance = resolveAxisDistance(
        [moving.top, moving.centerY, moving.bottom],
        [candidate.top, candidate.centerY, candidate.bottom],
      )
      const isNearby =
        xDistance <= maxAxisDistance ||
        yDistance <= maxAxisDistance ||
        intersectsExpandedRect(movingRect, candidateRect, WORKSPACE_SNAP_SEARCH_PADDING_PX)

      return {
        candidateRect,
        distance: Math.min(xDistance, yDistance),
        area: candidateRect.width * candidateRect.height,
        isNearby,
      }
    })
    .filter(candidate => candidate.isNearby)

  if (rankedCandidates.length <= WORKSPACE_SNAP_MAX_CANDIDATES) {
    return rankedCandidates.map(candidate => candidate.candidateRect)
  }

  return rankedCandidates
    .sort((left, right) => {
      if (left.distance !== right.distance) {
        return left.distance - right.distance
      }

      return left.area - right.area
    })
    .slice(0, WORKSPACE_SNAP_MAX_CANDIDATES)
    .map(candidate => candidate.candidateRect)
}

function pickBestAxisSnap(candidates: AxisSnapResult[]): AxisSnapResult {
  let best: AxisSnapResult = { kind: 'none', delta: 0, guide: null }
  let bestAbs = Number.POSITIVE_INFINITY
  let bestKind: AxisSnapKind = 'none'

  for (const candidate of candidates) {
    if (candidate.kind === 'none') {
      continue
    }

    const abs = Math.abs(candidate.delta)
    if (abs < bestAbs) {
      best = candidate
      bestAbs = abs
      bestKind = candidate.kind
      continue
    }

    if (abs === bestAbs && bestKind === 'grid' && candidate.kind === 'object') {
      best = candidate
      bestKind = candidate.kind
    }
  }

  return best
}

export function areWorkspaceSnapGuidesEqual(
  left: WorkspaceSnapGuide[] | null,
  right: WorkspaceSnapGuide[] | null,
): boolean {
  if (left === right) {
    return true
  }

  if (!left || !right) {
    return left === right
  }

  if (left.length !== right.length) {
    return false
  }

  return left.every((guide, index) => {
    const otherGuide = right[index]
    if (!otherGuide || guide.kind !== otherGuide.kind) {
      return false
    }

    if (guide.kind === 'v') {
      if (otherGuide.kind !== 'v') {
        return false
      }

      return guide.x === otherGuide.x && guide.y1 === otherGuide.y1 && guide.y2 === otherGuide.y2
    }

    if (otherGuide.kind !== 'h') {
      return false
    }

    return guide.y === otherGuide.y && guide.x1 === otherGuide.x1 && guide.x2 === otherGuide.x2
  })
}

export function resolveWorkspaceSnap({
  movingRect,
  candidateRects,
  grid,
  threshold,
  enableGrid,
  enableObject,
}: {
  movingRect: WorkspaceSnapRect
  candidateRects: WorkspaceSnapRect[]
  grid: number
  threshold: number
  enableGrid: boolean
  enableObject: boolean
}): WorkspaceSnapResult {
  if (threshold <= 0 || (!enableGrid && !enableObject)) {
    return { dx: 0, dy: 0, guides: [] }
  }

  const moving = rectEdges(movingRect)
  const filteredCandidateRects = enableObject
    ? filterSnapCandidateRects({ movingRect, candidateRects, threshold })
    : []

  const xCandidates: AxisSnapResult[] = []
  const yCandidates: AxisSnapResult[] = []

  if (enableGrid) {
    const dx = resolveGridDelta(movingRect.x, grid)
    if (Math.abs(dx) <= threshold) {
      xCandidates.push({ kind: 'grid', delta: dx, guide: null })
    }

    const dy = resolveGridDelta(movingRect.y, grid)
    if (Math.abs(dy) <= threshold) {
      yCandidates.push({ kind: 'grid', delta: dy, guide: null })
    }
  }

  if (enableObject) {
    for (const rect of filteredCandidateRects) {
      const edges = rectEdges(rect)
      let yRange: { min: number; max: number } | null = null
      let xRange: { min: number; max: number } | null = null

      const axisPairsX: Array<[number, number]> = [
        [moving.left, edges.left],
        [moving.centerX, edges.centerX],
        [moving.right, edges.right],
      ]

      for (const [source, target] of axisPairsX) {
        const delta = target - source
        if (Math.abs(delta) > threshold) {
          continue
        }

        yRange ??= clampGuideRange(
          Math.min(moving.top, edges.top),
          Math.max(moving.bottom, edges.bottom),
        )
        xCandidates.push({
          kind: 'object',
          delta,
          guide: { kind: 'v', x: target, y1: yRange.min, y2: yRange.max },
        })
      }

      const axisPairsY: Array<[number, number]> = [
        [moving.top, edges.top],
        [moving.centerY, edges.centerY],
        [moving.bottom, edges.bottom],
      ]

      for (const [source, target] of axisPairsY) {
        const delta = target - source
        if (Math.abs(delta) > threshold) {
          continue
        }

        xRange ??= clampGuideRange(
          Math.min(moving.left, edges.left),
          Math.max(moving.right, edges.right),
        )
        yCandidates.push({
          kind: 'object',
          delta,
          guide: { kind: 'h', y: target, x1: xRange.min, x2: xRange.max },
        })
      }
    }
  }

  const bestX = pickBestAxisSnap(xCandidates)
  const bestY = pickBestAxisSnap(yCandidates)

  const guides = [bestX.guide, bestY.guide].filter(
    (guide): guide is WorkspaceSnapGuide => guide !== null,
  )

  return { dx: bestX.delta, dy: bestY.delta, guides }
}
