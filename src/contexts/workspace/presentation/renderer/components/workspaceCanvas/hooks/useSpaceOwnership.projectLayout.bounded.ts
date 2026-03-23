import type { WorkspaceSpaceRect } from '../../../types'
import {
  SPACE_NODE_PADDING,
  type LayoutDirection,
  type LayoutItem,
} from '../../../utils/spaceLayout'
import {
  rectIntersects,
  resolveDeltaToKeepRectInsideRect,
  type Rect,
} from './useSpaceOwnership.helpers'
import {
  resolveNearestNonOverlappingRectWithinBounds,
  resolveOffsetDirectionRank,
} from './useSpaceOwnership.projectLayout.bounded.placeRect'

function clampNodeRectInsideSpace(nodeRect: Rect, spaceRect: WorkspaceSpaceRect): Rect {
  const { dx, dy } = resolveDeltaToKeepRectInsideRect(nodeRect, spaceRect, SPACE_NODE_PADDING)
  if (dx === 0 && dy === 0) {
    return nodeRect
  }
  return {
    ...nodeRect,
    x: nodeRect.x + dx,
    y: nodeRect.y + dy,
  }
}

function computeRectCenter(rect: Rect): { x: number; y: number } {
  return { x: rect.x + rect.width * 0.5, y: rect.y + rect.height * 0.5 }
}

type LayoutCost = { maxSquared: number; movedCount: number; sumSquared: number }

function compareLayoutCost(a: LayoutCost, b: LayoutCost): number {
  if (a.maxSquared !== b.maxSquared) {
    return a.maxSquared - b.maxSquared
  }
  if (a.movedCount !== b.movedCount) {
    return a.movedCount - b.movedCount
  }
  return a.sumSquared - b.sumSquared
}

function resolvePinnedDeltaBounds({
  pinnedRects,
  bounds,
}: {
  pinnedRects: Rect[]
  bounds: { left: number; top: number; right: number; bottom: number }
}): { minDx: number; maxDx: number; minDy: number; maxDy: number } {
  let minDx = Number.NEGATIVE_INFINITY
  let maxDx = Number.POSITIVE_INFINITY
  let minDy = Number.NEGATIVE_INFINITY
  let maxDy = Number.POSITIVE_INFINITY
  for (const rect of pinnedRects) {
    minDx = Math.max(minDx, bounds.left - rect.x)
    maxDx = Math.min(maxDx, bounds.right - (rect.x + rect.width))
    minDy = Math.max(minDy, bounds.top - rect.y)
    maxDy = Math.min(maxDy, bounds.bottom - (rect.y + rect.height))
  }

  if (minDx > maxDx) {
    minDx = 0
    maxDx = 0
  }
  if (minDy > maxDy) {
    minDy = 0
    maxDy = 0
  }

  return { minDx, maxDx, minDy, maxDy }
}

function clampPinnedDelta({
  dx,
  dy,
  deltaBounds,
}: {
  dx: number
  dy: number
  deltaBounds: { minDx: number; maxDx: number; minDy: number; maxDy: number }
}): { dx: number; dy: number } {
  const nextDx = Math.min(Math.max(dx, deltaBounds.minDx), deltaBounds.maxDx)
  const nextDy = Math.min(Math.max(dy, deltaBounds.minDy), deltaBounds.maxDy)
  return { dx: nextDx, dy: nextDy }
}

function computeDeltaKey(delta: { dx: number; dy: number }): string {
  return `${delta.dx},${delta.dy}`
}

export function resolveBoundedSpaceNodeLayout({
  items,
  pinnedNodeIds,
  targetSpaceRect,
  dropCenter,
  directions,
  dragDx,
  dragDy,
}: {
  items: LayoutItem[]
  pinnedNodeIds: string[]
  targetSpaceRect: WorkspaceSpaceRect
  dropCenter: { x: number; y: number }
  directions: LayoutDirection[]
  dragDx: number
  dragDy: number
}): LayoutItem[] | null {
  const pinnedSet = new Set(pinnedNodeIds)

  const bounds = {
    left: targetSpaceRect.x + SPACE_NODE_PADDING,
    top: targetSpaceRect.y + SPACE_NODE_PADDING,
    right: targetSpaceRect.x + targetSpaceRect.width - SPACE_NODE_PADDING,
    bottom: targetSpaceRect.y + targetSpaceRect.height - SPACE_NODE_PADDING,
  }

  const baselineRectById = new Map<string, Rect>()
  items.forEach(item => {
    if (item.kind !== 'node') {
      return
    }

    const baseline = pinnedSet.has(item.groupId)
      ? { ...item.rect }
      : clampNodeRectInsideSpace(item.rect, targetSpaceRect)
    baselineRectById.set(item.groupId, baseline)
  })

  const pinnedBaselineRects = pinnedNodeIds
    .map(id => baselineRectById.get(id))
    .filter((rect): rect is Rect => Boolean(rect))

  const deltaBounds = resolvePinnedDeltaBounds({ pinnedRects: pinnedBaselineRects, bounds })

  const movableNodeIds = items
    .filter(item => item.kind === 'node' && !pinnedSet.has(item.groupId))
    .map(item => item.groupId)

  const rectCenterById = new Map<string, { x: number; y: number }>()
  baselineRectById.forEach((rect, id) => rectCenterById.set(id, computeRectCenter(rect)))

  const distanceSquaredToDropCenter = (nodeId: string): number => {
    const center = rectCenterById.get(nodeId)
    if (!center) {
      return Number.POSITIVE_INFINITY
    }

    const dx = center.x - dropCenter.x
    const dy = center.y - dropCenter.y
    return dx * dx + dy * dy
  }

  const stable = [...movableNodeIds].sort()
  const near = [...movableNodeIds].sort(
    (a, b) => distanceSquaredToDropCenter(a) - distanceSquaredToDropCenter(b),
  )
  const far = [...movableNodeIds].sort(
    (a, b) => distanceSquaredToDropCenter(b) - distanceSquaredToDropCenter(a),
  )

  const primaryAxis = Math.abs(dragDx) >= Math.abs(dragDy) ? ('x' as const) : ('y' as const)
  const axisSign = primaryAxis === 'x' ? (dragDx >= 0 ? 1 : -1) : dragDy >= 0 ? 1 : -1
  const sweep = [...movableNodeIds].sort((a, b) => {
    const aCenter = rectCenterById.get(a)
    const bCenter = rectCenterById.get(b)
    if (!aCenter || !bCenter) {
      return a.localeCompare(b)
    }

    const aAhead =
      primaryAxis === 'x'
        ? axisSign >= 0
          ? aCenter.x >= dropCenter.x
          : aCenter.x <= dropCenter.x
        : axisSign >= 0
          ? aCenter.y >= dropCenter.y
          : aCenter.y <= dropCenter.y
    const bAhead =
      primaryAxis === 'x'
        ? axisSign >= 0
          ? bCenter.x >= dropCenter.x
          : bCenter.x <= dropCenter.x
        : axisSign >= 0
          ? bCenter.y >= dropCenter.y
          : bCenter.y <= dropCenter.y

    if (aAhead !== bAhead) {
      return aAhead ? -1 : 1
    }

    if (primaryAxis === 'y') {
      if (aCenter.x !== bCenter.x) {
        return aAhead ? aCenter.x - bCenter.x : bCenter.x - aCenter.x
      }
      return aCenter.y - bCenter.y
    }

    if (aCenter.y !== bCenter.y) {
      return aAhead ? aCenter.y - bCenter.y : bCenter.y - aCenter.y
    }
    return aCenter.x - bCenter.x
  })

  const orders: Array<{ name: string; ids: string[] }> = [
    { name: 'sweep', ids: sweep },
    { name: 'near', ids: near },
    { name: 'far', ids: far },
    { name: 'stable', ids: stable },
  ]

  const solvePinnedDelta = (delta: {
    dx: number
    dy: number
  }): { rectById: Map<string, Rect>; cost: LayoutCost } | null => {
    let best: { rectById: Map<string, Rect>; cost: LayoutCost } | null = null

    for (const order of orders) {
      const placedRectById = new Map<string, Rect>()

      pinnedNodeIds.forEach(nodeId => {
        const rect = baselineRectById.get(nodeId)
        if (!rect) {
          return
        }

        placedRectById.set(nodeId, {
          ...rect,
          x: rect.x + delta.dx,
          y: rect.y + delta.dy,
        })
      })

      for (const nodeId of pinnedNodeIds) {
        const rect = placedRectById.get(nodeId)
        if (!rect) {
          continue
        }

        const right = rect.x + rect.width
        const bottom = rect.y + rect.height
        if (
          rect.x < bounds.left ||
          rect.y < bounds.top ||
          right > bounds.right ||
          bottom > bounds.bottom
        ) {
          return null
        }
      }

      if (pinnedNodeIds.length > 1) {
        for (let i = 0; i < pinnedNodeIds.length; i += 1) {
          const aId = pinnedNodeIds[i]
          const rectA = aId ? placedRectById.get(aId) : null
          if (!rectA) {
            continue
          }

          for (let j = i + 1; j < pinnedNodeIds.length; j += 1) {
            const bId = pinnedNodeIds[j]
            const rectB = bId ? placedRectById.get(bId) : null
            if (!rectB) {
              continue
            }

            if (rectIntersects(rectA, rectB)) {
              return null
            }
          }
        }
      }

      let ok = true

      for (const nodeId of order.ids) {
        const desiredRect = baselineRectById.get(nodeId)
        if (!desiredRect) {
          continue
        }

        const obstacles = [...placedRectById.values()]
        const placed = resolveNearestNonOverlappingRectWithinBounds({
          desired: desiredRect,
          obstacles,
          bounds,
          directions,
        })
        if (!placed) {
          ok = false
          break
        }

        placedRectById.set(nodeId, placed)
      }

      if (!ok) {
        continue
      }

      let maxSquared = 0
      let movedCount = 0
      let sumSquared = 0

      movableNodeIds.forEach(nodeId => {
        const baseline = baselineRectById.get(nodeId)
        const next = placedRectById.get(nodeId) ?? baseline
        if (!baseline || !next) {
          return
        }

        const dx = next.x - baseline.x
        const dy = next.y - baseline.y
        if (dx === 0 && dy === 0) {
          return
        }

        movedCount += 1
        const squared = dx * dx + dy * dy
        maxSquared = Math.max(maxSquared, squared)
        sumSquared += squared
      })

      const cost: LayoutCost = { maxSquared, movedCount, sumSquared }
      if (!best || compareLayoutCost(cost, best.cost) < 0) {
        best = { rectById: placedRectById, cost }
      }
    }

    return best
  }

  type Solution = {
    rectById: Map<string, Rect>
    cost: LayoutCost
    delta: { dx: number; dy: number }
  }
  const compareSolution = (a: Solution, b: Solution): number => {
    const aSq = a.delta.dx * a.delta.dx + a.delta.dy * a.delta.dy
    const bSq = b.delta.dx * b.delta.dx + b.delta.dy * b.delta.dy
    if (aSq !== bSq) {
      return aSq - bSq
    }

    const aMan = Math.abs(a.delta.dx) + Math.abs(a.delta.dy)
    const bMan = Math.abs(b.delta.dx) + Math.abs(b.delta.dy)
    if (aMan !== bMan) {
      return aMan - bMan
    }

    const costCmp = compareLayoutCost(a.cost, b.cost)
    if (costCmp !== 0) {
      return costCmp
    }

    const aRank = resolveOffsetDirectionRank({ dx: a.delta.dx, dy: a.delta.dy, directions })
    const bRank = resolveOffsetDirectionRank({ dx: b.delta.dx, dy: b.delta.dy, directions })
    if (aRank !== bRank) {
      return aRank - bRank
    }

    if (a.delta.dy !== b.delta.dy) {
      return a.delta.dy - b.delta.dy
    }

    return a.delta.dx - b.delta.dx
  }

  const candidateDeltaByKey = new Map<string, { dx: number; dy: number }>()
  const clampedZeroDelta = clampPinnedDelta({ dx: 0, dy: 0, deltaBounds })
  candidateDeltaByKey.set(computeDeltaKey(clampedZeroDelta), clampedZeroDelta)

  for (const pinnedId of pinnedNodeIds) {
    const pinnedRect = baselineRectById.get(pinnedId)
    if (!pinnedRect) {
      continue
    }

    const boundsCandidates: Array<{ dx: number; dy: number }> = [
      { dx: bounds.left - pinnedRect.x, dy: 0 },
      { dx: bounds.right - (pinnedRect.x + pinnedRect.width), dy: 0 },
      { dx: 0, dy: bounds.top - pinnedRect.y },
      { dx: 0, dy: bounds.bottom - (pinnedRect.y + pinnedRect.height) },
    ]

    for (const candidate of boundsCandidates) {
      const clamped = clampPinnedDelta({
        dx: candidate.dx,
        dy: candidate.dy,
        deltaBounds,
      })
      candidateDeltaByKey.set(computeDeltaKey(clamped), clamped)
    }

    for (const movableId of movableNodeIds) {
      const movableRect = baselineRectById.get(movableId)
      if (!movableRect) {
        continue
      }

      const dxLeft = movableRect.x - pinnedRect.width - pinnedRect.x
      const dxRight = movableRect.x + movableRect.width - pinnedRect.x
      const dyUp = movableRect.y - pinnedRect.height - pinnedRect.y
      const dyDown = movableRect.y + movableRect.height - pinnedRect.y

      const rawCandidates: Array<{ dx: number; dy: number }> = [
        { dx: dxLeft, dy: 0 },
        { dx: dxRight, dy: 0 },
        { dx: 0, dy: dyUp },
        { dx: 0, dy: dyDown },
        { dx: dxLeft, dy: dyUp },
        { dx: dxLeft, dy: dyDown },
        { dx: dxRight, dy: dyUp },
        { dx: dxRight, dy: dyDown },
      ]

      for (const candidate of rawCandidates) {
        const clamped = clampPinnedDelta({
          dx: candidate.dx,
          dy: candidate.dy,
          deltaBounds,
        })
        candidateDeltaByKey.set(computeDeltaKey(clamped), clamped)
      }
    }
  }

  const candidates = [...candidateDeltaByKey.values()]
  candidates.sort((a, b) => {
    const aSq = a.dx * a.dx + a.dy * a.dy
    const bSq = b.dx * b.dx + b.dy * b.dy
    if (aSq !== bSq) {
      return aSq - bSq
    }

    const aMan = Math.abs(a.dx) + Math.abs(a.dy)
    const bMan = Math.abs(b.dx) + Math.abs(b.dy)
    if (aMan !== bMan) {
      return aMan - bMan
    }

    const aRank = resolveOffsetDirectionRank({ dx: a.dx, dy: a.dy, directions })
    const bRank = resolveOffsetDirectionRank({ dx: b.dx, dy: b.dy, directions })
    if (aRank !== bRank) {
      return aRank - bRank
    }

    if (a.dy !== b.dy) {
      return a.dy - b.dy
    }

    return a.dx - b.dx
  })

  let bestSolution: Solution | null = null
  let bestDeltaSq = Number.POSITIVE_INFINITY
  let bestDeltaMan = Number.POSITIVE_INFINITY

  for (const delta of candidates) {
    const deltaSq = delta.dx * delta.dx + delta.dy * delta.dy
    const deltaMan = Math.abs(delta.dx) + Math.abs(delta.dy)

    if (deltaSq > bestDeltaSq || (deltaSq === bestDeltaSq && deltaMan > bestDeltaMan)) {
      break
    }

    const solved = solvePinnedDelta(delta)
    if (!solved) {
      continue
    }

    const solution: Solution = { rectById: solved.rectById, cost: solved.cost, delta }
    if (!bestSolution || compareSolution(solution, bestSolution) < 0) {
      bestSolution = solution
      bestDeltaSq = deltaSq
      bestDeltaMan = deltaMan
    }
  }

  if (!bestSolution) {
    return null
  }

  const nextRectById = bestSolution.rectById

  return items.map(item => {
    if (item.kind !== 'node') {
      return item
    }

    const nextRect = nextRectById.get(item.groupId)
    if (!nextRect) {
      return item
    }

    return { ...item, rect: { ...nextRect } }
  })
}
