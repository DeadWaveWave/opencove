import type { WorkspaceSpaceRect } from '../types'

export type LayoutDirection = 'x+' | 'x-' | 'y+' | 'y-'

export interface LayoutItem {
  id: string
  kind: 'node' | 'space'
  groupId: string
  rect: WorkspaceSpaceRect
}

const PREFERRED_DIRECTION_PENALTY = 48

export function pushAwayLayout(_input: {
  items: LayoutItem[]
  pinnedGroupIds: string[]
  sourceGroupIds: string[]
  directions: LayoutDirection[]
  gap: number
  bounds?: { rect: WorkspaceSpaceRect; padding?: number }
}): LayoutItem[] {
  const nextItems: LayoutItem[] = _input.items.map(item => ({
    ...item,
    rect: { ...item.rect },
  }))

  const groupIndices = new Map<string, number[]>()
  nextItems.forEach((item, index) => {
    const existing = groupIndices.get(item.groupId)
    if (existing) {
      existing.push(index)
      return
    }

    groupIndices.set(item.groupId, [index])
  })

  const groupBounds = new Map<string, WorkspaceSpaceRect>()
  for (const [groupId, indices] of groupIndices.entries()) {
    if (indices.length === 0) {
      continue
    }

    let minX = Number.POSITIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY

    for (const index of indices) {
      const rect = nextItems[index]?.rect
      if (!rect) {
        continue
      }

      minX = Math.min(minX, rect.x)
      minY = Math.min(minY, rect.y)
      maxX = Math.max(maxX, rect.x + rect.width)
      maxY = Math.max(maxY, rect.y + rect.height)
    }

    if (
      !Number.isFinite(minX) ||
      !Number.isFinite(minY) ||
      !Number.isFinite(maxX) ||
      !Number.isFinite(maxY)
    ) {
      continue
    }

    groupBounds.set(groupId, {
      x: minX,
      y: minY,
      width: Math.max(0, maxX - minX),
      height: Math.max(0, maxY - minY),
    })
  }

  const pinned = new Set(_input.pinnedGroupIds)
  const groupIds = [...groupIndices.keys()]
  const preferredDirections = orderPreferredDirections(_input.directions)
  const preferredRankByDirection: Record<LayoutDirection, number> = {
    'x+': preferredDirections.indexOf('x+'),
    'x-': preferredDirections.indexOf('x-'),
    'y+': preferredDirections.indexOf('y+'),
    'y-': preferredDirections.indexOf('y-'),
  }
  const groupHasSpace = new Map<string, boolean>()
  nextItems.forEach(item => {
    if (item.kind !== 'space') {
      return
    }

    groupHasSpace.set(item.groupId, true)
  })

  const bounds = _input.bounds ?? null
  const boundsPadding = Math.max(0, bounds?.padding ?? 0)
  const boundsRect = bounds?.rect ?? null
  const allowedBounds = boundsRect
    ? {
        left: boundsRect.x + boundsPadding,
        top: boundsRect.y + boundsPadding,
        right: boundsRect.x + boundsRect.width - boundsPadding,
        bottom: boundsRect.y + boundsRect.height - boundsPadding,
      }
    : null

  const intersects = (a: WorkspaceSpaceRect, b: WorkspaceSpaceRect): boolean => {
    const aRight = a.x + a.width
    const aBottom = a.y + a.height
    const bRight = b.x + b.width
    const bBottom = b.y + b.height

    return !(aRight <= b.x || a.x >= bRight || aBottom <= b.y || a.y >= bBottom)
  }

  const moveGroupBy = (groupId: string, dx: number, dy: number): void => {
    const indices = groupIndices.get(groupId)
    if (!indices) {
      return
    }

    for (let i = 0; i < indices.length; i += 1) {
      const index = indices[i]
      if (typeof index !== 'number') {
        continue
      }

      const item = nextItems[index]
      if (!item) {
        continue
      }

      item.rect.x += dx
      item.rect.y += dy
    }

    const groupRect = groupBounds.get(groupId)
    if (groupRect) {
      groupRect.x += dx
      groupRect.y += dy
    }
  }

  const hasGroupIntersection = (sourceGroupId: string, targetGroupId: string): boolean => {
    const sourceRect = groupBounds.get(sourceGroupId)
    const targetRect = groupBounds.get(targetGroupId)
    if (!sourceRect || !targetRect) {
      return false
    }

    return intersects(sourceRect, targetRect)
  }

  const computePushDelta = (
    sourceGroupId: string,
    targetGroupId: string,
    gap: number,
  ): { dx: number; dy: number } => {
    const sourceRect = groupBounds.get(sourceGroupId)
    const targetRect = groupBounds.get(targetGroupId)
    if (!sourceRect || !targetRect || !intersects(sourceRect, targetRect)) {
      return { dx: 0, dy: 0 }
    }

    const sourceCenter = {
      x: sourceRect.x + sourceRect.width * 0.5,
      y: sourceRect.y + sourceRect.height * 0.5,
    }
    const targetCenter = {
      x: targetRect.x + targetRect.width * 0.5,
      y: targetRect.y + targetRect.height * 0.5,
    }

    const naturalDirections = resolveNaturalDirections({
      sourceCenter,
      targetCenter,
      preferredDirections,
    })

    let bestCandidateDx = 0
    let bestCandidateDy = 0
    let bestScore: {
      naturalRank: number
      preferredRank: number
      weightedDistance: number
      manhattan: number
      euclidean: number
      boundsViolation: number
    } | null = null

    for (let naturalRank = 0; naturalRank < naturalDirections.length; naturalRank += 1) {
      const direction = naturalDirections[naturalRank]
      if (!direction) {
        continue
      }

      let dx = 0
      let dy = 0

      if (direction === 'x+') {
        dx = sourceRect.x + sourceRect.width + gap - targetRect.x
      } else if (direction === 'x-') {
        dx = sourceRect.x - gap - (targetRect.x + targetRect.width)
      } else if (direction === 'y+') {
        dy = sourceRect.y + sourceRect.height + gap - targetRect.y
      } else {
        dy = sourceRect.y - gap - (targetRect.y + targetRect.height)
      }

      const boundsViolation =
        allowedBounds && !groupHasSpace.get(targetGroupId)
          ? computeBoundsViolation({
              bounds: allowedBounds,
              rect: {
                x: targetRect.x + dx,
                y: targetRect.y + dy,
                width: targetRect.width,
                height: targetRect.height,
              },
            })
          : 0
      const manhattan = Math.abs(dx) + Math.abs(dy)
      const euclidean = dx * dx + dy * dy
      const preferredRank = preferredRankByDirection[direction]
      const score = {
        naturalRank,
        preferredRank,
        weightedDistance: manhattan + preferredRank * PREFERRED_DIRECTION_PENALTY,
        manhattan,
        euclidean,
        boundsViolation,
      }

      const scoreComparison = bestScore ? comparePushScore(score, bestScore) : -1

      if (scoreComparison < 0) {
        bestCandidateDx = dx
        bestCandidateDy = dy
        bestScore = score
        continue
      }

      if (scoreComparison > 0 || !bestScore) {
        continue
      }

      if (comparePushDelta({ dx, dy }, { dx: bestCandidateDx, dy: bestCandidateDy }) < 0) {
        bestCandidateDx = dx
        bestCandidateDy = dy
        bestScore = score
      }
    }

    return bestScore ? { dx: bestCandidateDx, dy: bestCandidateDy } : { dx: 0, dy: 0 }
  }

  const initialQueue = (): string[] => {
    const ordered = _input.sourceGroupIds.filter(groupId => groupIndices.has(groupId))

    if (ordered.length > 0) {
      return ordered
    }

    const fallback = groupIds.find(groupId => pinned.has(groupId))
    return fallback ? [fallback] : []
  }

  const queue = initialQueue()
  const inQueue = new Set(queue)
  let queueIndex = 0
  const maxIterations = Math.max(20, groupIds.length * groupIds.length * 6)
  let iterations = 0

  while (queueIndex < queue.length && iterations < maxIterations) {
    iterations += 1
    const sourceGroupId = queue[queueIndex]
    queueIndex += 1
    if (!sourceGroupId) {
      continue
    }

    inQueue.delete(sourceGroupId)

    for (const targetGroupId of groupIds) {
      if (targetGroupId === sourceGroupId) {
        continue
      }

      if (pinned.has(targetGroupId)) {
        continue
      }

      if (!hasGroupIntersection(sourceGroupId, targetGroupId)) {
        continue
      }

      const { dx, dy } = computePushDelta(sourceGroupId, targetGroupId, _input.gap)
      if (dx === 0 && dy === 0) {
        continue
      }

      moveGroupBy(targetGroupId, dx, dy)

      if (!inQueue.has(targetGroupId)) {
        queue.push(targetGroupId)
        inQueue.add(targetGroupId)
      }

      for (const pinnedGroupId of pinned) {
        if (!groupIndices.has(pinnedGroupId)) {
          continue
        }

        if (!hasGroupIntersection(pinnedGroupId, targetGroupId)) {
          continue
        }

        if (!inQueue.has(pinnedGroupId)) {
          queue.push(pinnedGroupId)
          inQueue.add(pinnedGroupId)
        }
      }
    }
  }

  return nextItems
}

function computeBoundsViolation({
  bounds,
  rect,
}: {
  bounds: { left: number; top: number; right: number; bottom: number }
  rect: WorkspaceSpaceRect
}): number {
  const rectRight = rect.x + rect.width
  const rectBottom = rect.y + rect.height

  let violation = 0
  if (rect.x < bounds.left) {
    violation += bounds.left - rect.x
  }
  if (rect.y < bounds.top) {
    violation += bounds.top - rect.y
  }
  if (rectRight > bounds.right) {
    violation += rectRight - bounds.right
  }
  if (rectBottom > bounds.bottom) {
    violation += rectBottom - bounds.bottom
  }

  return violation
}

function orderPreferredDirections(directions: LayoutDirection[]): LayoutDirection[] {
  const ordered: LayoutDirection[] = []
  const seen = new Set<LayoutDirection>()

  const pushDirection = (direction: LayoutDirection): void => {
    if (seen.has(direction)) {
      return
    }

    seen.add(direction)
    ordered.push(direction)
  }

  directions.forEach(pushDirection)
  ;(['x+', 'x-', 'y+', 'y-'] as const).forEach(pushDirection)

  return ordered
}

function resolveNaturalDirections({
  sourceCenter,
  targetCenter,
  preferredDirections,
}: {
  sourceCenter: { x: number; y: number }
  targetCenter: { x: number; y: number }
  preferredDirections: LayoutDirection[]
}): LayoutDirection[] {
  const dx = targetCenter.x - sourceCenter.x
  const dy = targetCenter.y - sourceCenter.y

  const xDirection = dx >= 0 ? ('x+' as const) : ('x-' as const)
  const yDirection = dy >= 0 ? ('y+' as const) : ('y-' as const)

  const ordered: LayoutDirection[] = []
  const seen = new Set<LayoutDirection>()

  const pushDirection = (direction: LayoutDirection): void => {
    if (seen.has(direction)) {
      return
    }

    seen.add(direction)
    ordered.push(direction)
  }

  if (Math.abs(dx) >= Math.abs(dy)) {
    pushDirection(xDirection)
    pushDirection(yDirection)
  } else {
    pushDirection(yDirection)
    pushDirection(xDirection)
  }

  preferredDirections.forEach(pushDirection)
  ;(['x+', 'x-', 'y+', 'y-'] as const).forEach(pushDirection)

  return ordered
}

function comparePushScore(
  left: {
    naturalRank: number
    preferredRank: number
    weightedDistance: number
    manhattan: number
    euclidean: number
    boundsViolation: number
  },
  right: {
    naturalRank: number
    preferredRank: number
    weightedDistance: number
    manhattan: number
    euclidean: number
    boundsViolation: number
  },
): number {
  if (left.boundsViolation !== right.boundsViolation) {
    return left.boundsViolation - right.boundsViolation
  }

  if (left.weightedDistance !== right.weightedDistance) {
    return left.weightedDistance - right.weightedDistance
  }

  if (left.preferredRank !== right.preferredRank) {
    return left.preferredRank - right.preferredRank
  }

  if (left.manhattan !== right.manhattan) {
    return left.manhattan - right.manhattan
  }

  if (left.naturalRank !== right.naturalRank) {
    return left.naturalRank - right.naturalRank
  }

  return left.euclidean - right.euclidean
}

function comparePushDelta(
  left: { dx: number; dy: number },
  right: { dx: number; dy: number },
): number {
  const leftDirection = classifyPushDirection(left)
  const rightDirection = classifyPushDirection(right)

  if (leftDirection !== rightDirection) {
    return leftDirection.localeCompare(rightDirection)
  }

  if (left.dy !== right.dy) {
    return left.dy - right.dy
  }

  return left.dx - right.dx
}

function classifyPushDirection(delta: { dx: number; dy: number }): LayoutDirection {
  if (delta.dx > 0) {
    return 'x+'
  }

  if (delta.dx < 0) {
    return 'x-'
  }

  if (delta.dy > 0) {
    return 'y+'
  }

  return 'y-'
}
