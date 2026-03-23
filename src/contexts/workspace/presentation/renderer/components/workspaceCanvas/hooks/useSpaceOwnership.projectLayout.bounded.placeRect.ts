import type { LayoutDirection } from '../../../utils/spaceLayout'
import { rectIntersects, type Rect } from './useSpaceOwnership.helpers'

export function resolveOffsetDirectionRank({
  dx,
  dy,
  directions,
}: {
  dx: number
  dy: number
  directions: LayoutDirection[]
}): number {
  if (dx === 0 && dy === 0) {
    return directions.length
  }

  let best = directions.length

  if (dx > 0) {
    best = Math.min(best, directions.indexOf('x+'))
  } else if (dx < 0) {
    best = Math.min(best, directions.indexOf('x-'))
  }

  if (dy > 0) {
    best = Math.min(best, directions.indexOf('y+'))
  } else if (dy < 0) {
    best = Math.min(best, directions.indexOf('y-'))
  }

  return best
}

const BOUNDED_PLACEMENT_PREFERRED_DIRECTION_PENALTY = 48

const GRID_STEP = 4
const MAX_SCAN_RADIUS = 80

const cachedOffsetsByDirectionKey = new Map<
  string,
  Map<number, Array<{ dx: number; dy: number }>>
>()

function resolveGridOffsetsForRadius(
  radius: number,
  directions: LayoutDirection[],
): Array<{ dx: number; dy: number }> {
  const directionKey = directions.join(',')
  const existing = cachedOffsetsByDirectionKey.get(directionKey)
  const byRadius = existing ?? new Map<number, Array<{ dx: number; dy: number }>>()

  if (!existing) {
    cachedOffsetsByDirectionKey.set(directionKey, byRadius)
  }

  const cached = byRadius.get(radius)
  if (cached) {
    return cached
  }

  const offsets: Array<{ dx: number; dy: number }> = []

  const scaledRadius = radius * GRID_STEP
  for (let x = -radius; x <= radius; x += 1) {
    const scaledX = x * GRID_STEP
    offsets.push({ dx: scaledX, dy: -scaledRadius })
    offsets.push({ dx: scaledX, dy: scaledRadius })
  }

  for (let y = -radius + 1; y <= radius - 1; y += 1) {
    const scaledY = y * GRID_STEP
    offsets.push({ dx: -scaledRadius, dy: scaledY })
    offsets.push({ dx: scaledRadius, dy: scaledY })
  }

  offsets.sort((a, b) => {
    const aMan = Math.abs(a.dx) + Math.abs(a.dy)
    const bMan = Math.abs(b.dx) + Math.abs(b.dy)
    const aRank = resolveOffsetDirectionRank({ dx: a.dx, dy: a.dy, directions })
    const bRank = resolveOffsetDirectionRank({ dx: b.dx, dy: b.dy, directions })
    const aWeighted = aMan + aRank * BOUNDED_PLACEMENT_PREFERRED_DIRECTION_PENALTY
    const bWeighted = bMan + bRank * BOUNDED_PLACEMENT_PREFERRED_DIRECTION_PENALTY
    if (aWeighted !== bWeighted) {
      return aWeighted - bWeighted
    }

    if (aMan !== bMan) {
      return aMan - bMan
    }

    return a.dx * a.dx + a.dy * a.dy - (b.dx * b.dx + b.dy * b.dy)
  })

  byRadius.set(radius, offsets)
  return offsets
}

export function resolveNearestNonOverlappingRectWithinBounds({
  desired,
  obstacles,
  bounds,
  directions,
}: {
  desired: Rect
  obstacles: Rect[]
  bounds: { left: number; top: number; right: number; bottom: number }
  directions: LayoutDirection[]
}): Rect | null {
  const clampPoint = (point: { x: number; y: number }): { x: number; y: number } => ({
    x: Math.min(
      Math.max(point.x, bounds.left),
      Math.max(bounds.left, bounds.right - desired.width),
    ),
    y: Math.min(
      Math.max(point.y, bounds.top),
      Math.max(bounds.top, bounds.bottom - desired.height),
    ),
  })

  const fitsBounds = (point: { x: number; y: number }): boolean => {
    return (
      point.x >= bounds.left &&
      point.y >= bounds.top &&
      point.x + desired.width <= bounds.right &&
      point.y + desired.height <= bounds.bottom
    )
  }

  const intersectsAny = (point: { x: number; y: number }): boolean => {
    const candidate = { x: point.x, y: point.y, width: desired.width, height: desired.height }
    return obstacles.some(obstacle => rectIntersects(candidate, obstacle))
  }

  const safeDesired = clampPoint({ x: desired.x, y: desired.y })
  if (fitsBounds(safeDesired) && !intersectsAny(safeDesired)) {
    return { ...desired, x: safeDesired.x, y: safeDesired.y }
  }

  const candidatePoints: Array<{ x: number; y: number }> = [
    safeDesired,
    { x: bounds.left, y: safeDesired.y },
    { x: Math.max(bounds.left, bounds.right - desired.width), y: safeDesired.y },
    { x: safeDesired.x, y: bounds.top },
    { x: safeDesired.x, y: Math.max(bounds.top, bounds.bottom - desired.height) },
  ]

  obstacles.forEach(obstacle => {
    const left = obstacle.x - desired.width
    const right = obstacle.x + obstacle.width
    const up = obstacle.y - desired.height
    const down = obstacle.y + obstacle.height

    candidatePoints.push(
      { x: left, y: safeDesired.y },
      { x: right, y: safeDesired.y },
      { x: safeDesired.x, y: up },
      { x: safeDesired.x, y: down },
      { x: left, y: up },
      { x: left, y: down },
      { x: right, y: up },
      { x: right, y: down },
    )
  })

  const uniqueCandidates: Array<{ x: number; y: number; violation: number }> = []
  const byKey = new Map<string, { x: number; y: number; violation: number }>()

  candidatePoints.forEach(candidate => {
    const clamped = clampPoint(candidate)
    const violation = Math.abs(clamped.x - candidate.x) + Math.abs(clamped.y - candidate.y)
    const key = `${clamped.x},${clamped.y}`
    const existing = byKey.get(key)
    if (existing && existing.violation <= violation) {
      return
    }

    byKey.set(key, { x: clamped.x, y: clamped.y, violation })
  })

  byKey.forEach(value => uniqueCandidates.push(value))

  uniqueCandidates.sort((a, b) => {
    if (a.violation !== b.violation) {
      return a.violation - b.violation
    }

    const aDx = a.x - safeDesired.x
    const aDy = a.y - safeDesired.y
    const bDx = b.x - safeDesired.x
    const bDy = b.y - safeDesired.y

    const aMan = Math.abs(aDx) + Math.abs(aDy)
    const bMan = Math.abs(bDx) + Math.abs(bDy)
    const aRank = resolveOffsetDirectionRank({ dx: aDx, dy: aDy, directions })
    const bRank = resolveOffsetDirectionRank({ dx: bDx, dy: bDy, directions })
    const aWeighted = aMan + aRank * BOUNDED_PLACEMENT_PREFERRED_DIRECTION_PENALTY
    const bWeighted = bMan + bRank * BOUNDED_PLACEMENT_PREFERRED_DIRECTION_PENALTY
    if (aWeighted !== bWeighted) {
      return aWeighted - bWeighted
    }

    if (aMan !== bMan) {
      return aMan - bMan
    }

    const aSq = aDx * aDx + aDy * aDy
    const bSq = bDx * bDx + bDy * bDy
    return aSq - bSq
  })

  for (const candidate of uniqueCandidates) {
    if (!fitsBounds(candidate) || intersectsAny(candidate)) {
      continue
    }

    return { ...desired, x: candidate.x, y: candidate.y }
  }

  for (let radius = 1; radius <= MAX_SCAN_RADIUS; radius += 1) {
    const offsets = resolveGridOffsetsForRadius(radius, directions)

    for (const offset of offsets) {
      const candidate = clampPoint({
        x: safeDesired.x + offset.dx,
        y: safeDesired.y + offset.dy,
      })

      if (!fitsBounds(candidate) || intersectsAny(candidate)) {
        continue
      }

      return { ...desired, x: candidate.x, y: candidate.y }
    }
  }

  return null
}
