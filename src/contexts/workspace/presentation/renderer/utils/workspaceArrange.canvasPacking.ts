import type { Rect } from './workspaceArrange.flowPacking'
import {
  computeBoundingRect,
  resolveDensePacking,
  resolveFlowPacking,
} from './workspaceArrange.flowPacking'
import type { WorkspaceArrangeItem } from './workspaceArrange.ordering'

const SECTION_PACKING_AREA_TOLERANCE = 1.25

export interface PlacementCandidate {
  placements: Map<string, { x: number; y: number }>
  bounding: Rect
}

export function resolveAspectPenalty(aspect: number, targetAspect: number): number {
  if (!Number.isFinite(aspect) || aspect <= 0) {
    return Number.POSITIVE_INFINITY
  }

  if (!Number.isFinite(targetAspect) || targetAspect <= 0) {
    return 0
  }

  return Math.abs(Math.log(aspect / targetAspect))
}

export function resolveSectionWrapWidthCandidates({
  items,
  wrapWidth,
  gap,
  targetAspect,
}: {
  items: WorkspaceArrangeItem[]
  wrapWidth: number
  gap: number
  targetAspect: number
}): number[] {
  if (items.length === 0) {
    return []
  }

  const maxItemWidth = Math.max(...items.map(item => item.rect.width))
  const totalArea = items.reduce((sum, item) => sum + item.rect.width * item.rect.height, 0)
  const totalWidth =
    items.reduce((sum, item) => sum + item.rect.width, 0) + Math.max(0, items.length - 1) * gap
  const safeAspect = Number.isFinite(targetAspect) && targetAspect > 0 ? targetAspect : 16 / 9
  const estimatedWidth = Math.round(
    Math.sqrt(Math.max(totalArea, maxItemWidth * maxItemWidth) * safeAspect),
  )

  const candidates = new Set<number>()
  const addCandidate = (value: number) => {
    if (!Number.isFinite(value)) {
      return
    }

    candidates.add(Math.max(maxItemWidth, Math.round(value)))
  }

  addCandidate(maxItemWidth)
  addCandidate(wrapWidth)
  addCandidate(estimatedWidth)
  addCandidate(estimatedWidth * 0.85)
  addCandidate(estimatedWidth * 1.15)
  addCandidate(totalWidth)

  let runningRowWidth = 0
  for (const [index, item] of items.entries()) {
    runningRowWidth += item.rect.width
    if (index > 0) {
      runningRowWidth += gap
    }
    addCandidate(runningRowWidth)
  }

  return [...candidates].sort((left, right) => left - right)
}

function createPlacementCandidate(
  items: WorkspaceArrangeItem[],
  placements: Map<string, { x: number; y: number }>,
): PlacementCandidate {
  return {
    placements,
    bounding: computePlacedBoundingRect(items, placements) ?? { x: 0, y: 0, width: 0, height: 0 },
  }
}

function serializePlacementCandidate(candidate: PlacementCandidate): string {
  const placements = [...candidate.placements.entries()]
    .sort(([leftId], [rightId]) => leftId.localeCompare(rightId))
    .map(([id, placement]) => `${id}:${placement.x},${placement.y}`)
    .join('|')

  return [
    candidate.bounding.x,
    candidate.bounding.y,
    candidate.bounding.width,
    candidate.bounding.height,
    placements,
  ].join(';')
}

export function dedupePlacementCandidates(candidates: PlacementCandidate[]): PlacementCandidate[] {
  const unique = new Map<string, PlacementCandidate>()

  for (const candidate of candidates) {
    const key = serializePlacementCandidate(candidate)
    if (!unique.has(key)) {
      unique.set(key, candidate)
    }
  }

  return [...unique.values()]
}

export function translatePlacementCandidate(
  candidate: PlacementCandidate,
  offset: { x: number; y: number },
): PlacementCandidate {
  const placements = new Map(
    [...candidate.placements.entries()].map(([id, placement]) => [
      id,
      {
        x: placement.x + offset.x,
        y: placement.y + offset.y,
      },
    ]),
  )

  return {
    placements,
    bounding: {
      x: candidate.bounding.x + offset.x,
      y: candidate.bounding.y + offset.y,
      width: candidate.bounding.width,
      height: candidate.bounding.height,
    },
  }
}

function createEmptyPlacementCandidate(): PlacementCandidate {
  return {
    placements: new Map(),
    bounding: { x: 0, y: 0, width: 0, height: 0 },
  }
}

export function resolveCanvasSectionPlacementCandidates({
  items,
  start,
  wrapWidth,
  gap,
  packing = 'flow',
  targetAspect,
}: {
  items: WorkspaceArrangeItem[]
  start: { x: number; y: number }
  wrapWidth: number
  gap: number
  packing?: 'dense' | 'flow'
  targetAspect: number
}): PlacementCandidate[] {
  if (items.length === 0) {
    return [createEmptyPlacementCandidate()]
  }

  const placementItems = items.map(item => ({
    id: item.key,
    width: item.rect.width,
    height: item.rect.height,
  }))
  const candidates = resolveSectionWrapWidthCandidates({
    items,
    wrapWidth,
    gap,
    targetAspect,
  })

  const ranked = candidates
    .map(candidateWrapWidth => {
      const placements =
        packing === 'dense'
          ? resolveDensePacking({
              items: placementItems,
              start,
              wrapWidth: candidateWrapWidth,
              gap,
            })
          : resolveFlowPacking({
              items: placementItems,
              start,
              wrapWidth: candidateWrapWidth,
              gap,
            })
      const candidate = createPlacementCandidate(items, placements)

      return {
        candidate,
        area: candidate.bounding.width * candidate.bounding.height,
        aspectPenalty: resolveAspectPenalty(
          candidate.bounding.height > 0
            ? candidate.bounding.width / candidate.bounding.height
            : Number.POSITIVE_INFINITY,
          targetAspect,
        ),
      }
    })
    .filter(
      rankedCandidate =>
        rankedCandidate.candidate.bounding.width > 0 ||
        rankedCandidate.candidate.bounding.height > 0,
    )

  if (ranked.length === 0) {
    return [createEmptyPlacementCandidate()]
  }

  const minArea = Math.min(...ranked.map(candidate => candidate.area))
  const compactCandidates = ranked.filter(
    candidate => candidate.area <= minArea * SECTION_PACKING_AREA_TOLERANCE,
  )
  const preferred = compactCandidates.length > 0 ? compactCandidates : ranked

  return dedupePlacementCandidates(preferred.map(candidate => candidate.candidate))
}

function computePlacedBoundingRect(
  items: WorkspaceArrangeItem[],
  placements: Map<string, { x: number; y: number }>,
) {
  return computeBoundingRect(
    items
      .map(item => {
        const placed = placements.get(item.key)
        if (!placed) {
          return null
        }

        return {
          x: placed.x,
          y: placed.y,
          width: item.rect.width,
          height: item.rect.height,
        }
      })
      .filter((rect): rect is NonNullable<typeof rect> => rect !== null),
  )
}
