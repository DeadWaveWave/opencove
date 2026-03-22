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
    for (const rect of candidateRects) {
      const edges = rectEdges(rect)

      const yRange = clampGuideRange(
        Math.min(moving.top, edges.top),
        Math.max(moving.bottom, edges.bottom),
      )
      const xRange = clampGuideRange(
        Math.min(moving.left, edges.left),
        Math.max(moving.right, edges.right),
      )

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
