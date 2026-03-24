import type { Node } from '@xyflow/react'
import type { StandardWindowSizeBucket } from '@contexts/settings/domain/agentSettings'
import type { Size, TerminalNodeData, WorkspaceSpaceState } from '../types'
import { computeSpaceRectFromNodes } from './spaceLayout'
import { computeBoundingRect, snapDown, type Rect } from './workspaceArrange.flowPacking'
import type { PlacementCandidate } from './workspaceArrange.canvasPacking'
import {
  dedupePlacementCandidates,
  resolveAspectPenalty,
  resolveCanvasSectionPlacementCandidates,
  resolveSectionWrapWidthCandidates,
  translatePlacementCandidate,
} from './workspaceArrange.canvasPacking'
import {
  createArrangeItemsForCanvasSpaces,
  type WorkspaceArrangeItem,
} from './workspaceArrange.ordering'
import {
  createWorkspaceArrangeSemanticFlowItems,
  createWorkspaceArrangeSemanticGroups,
  resolveWorkspaceArrangeSemanticGridPlacements,
  resolveWorkspaceArrangeSemanticNodePlacements,
} from './workspaceArrange.semantic'
import {
  computeOwnedNodeIdSet,
  resolveArrangeStyle,
  WORKSPACE_ARRANGE_GAP_PX,
  WORKSPACE_ARRANGE_GRID_PX,
  type WorkspaceArrangeResult,
  type WorkspaceArrangeStyle,
} from './workspaceArrange.shared'
import { resolveViewportAspectRatio } from './workspaceArrange.viewport'
import {
  normalizeWorkspaceNodesToCanonicalSizing,
  resolveCanonicalBucketCellSize,
  WORKSPACE_CANONICAL_GUTTER_PX,
} from './workspaceNodeSizing'

const SECTION_PACKING_ASPECT_EPSILON = 0.01

export function arrangeWorkspaceCanvas({
  nodes,
  spaces,
  wrapWidth,
  viewport,
  standardWindowSizeBucket,
  style,
  gap = WORKSPACE_ARRANGE_GAP_PX,
  grid = WORKSPACE_ARRANGE_GRID_PX,
}: {
  nodes: Node<TerminalNodeData>[]
  spaces: WorkspaceSpaceState[]
  wrapWidth: number
  viewport?: Partial<Size>
  standardWindowSizeBucket?: StandardWindowSizeBucket
  style?: WorkspaceArrangeStyle
  gap?: number
  grid?: number
}): WorkspaceArrangeResult {
  const resolvedStyle = resolveArrangeStyle(style)
  const ownedNodeIdSet = computeOwnedNodeIdSet(spaces)
  const rootNodeIdSet = new Set(
    nodes.filter(node => !ownedNodeIdSet.has(node.id)).map(node => node.id),
  )
  const canonicalBucket = resolvedStyle.alignCanonicalSizes
    ? (standardWindowSizeBucket ?? 'regular')
    : 'regular'
  const canonicalSizingNormalized = normalizeWorkspaceNodesToCanonicalSizing({
    nodes,
    enabled: resolvedStyle.alignCanonicalSizes,
    nodeIdSet: rootNodeIdSet,
    bucket: canonicalBucket,
  })
  const nodesWithStandardSizing = canonicalSizingNormalized.nodes

  const nodeById = new Map(nodesWithStandardSizing.map(node => [node.id, node]))

  let didSpaceFitChange = false
  const fittedSpaces = spaces.map(space => {
    if (resolvedStyle.spaceFit === 'keep') {
      return space
    }

    const ownedNodes = space.nodeIds
      .map(nodeId => nodeById.get(nodeId))
      .filter((node): node is Node<TerminalNodeData> => Boolean(node))

    if (ownedNodes.length === 0) {
      return space
    }

    const required = computeSpaceRectFromNodes(
      ownedNodes.map(node => ({
        x: node.position.x,
        y: node.position.y,
        width: node.data.width,
        height: node.data.height,
      })),
    )

    if (!space.rect) {
      didSpaceFitChange = true
      return { ...space, rect: required }
    }

    const nextRect = required
    if (
      nextRect.x === space.rect.x &&
      nextRect.y === space.rect.y &&
      nextRect.width === space.rect.width &&
      nextRect.height === space.rect.height
    ) {
      return space
    }

    didSpaceFitChange = true
    return { ...space, rect: nextRect }
  })

  const spaceItems = createArrangeItemsForCanvasSpaces({
    nodes: nodesWithStandardSizing,
    spaces: fittedSpaces,
    order: resolvedStyle.order,
  })
  const rootGroups = createWorkspaceArrangeSemanticGroups({
    nodes: nodesWithStandardSizing.filter(node => rootNodeIdSet.has(node.id)),
    order: resolvedStyle.order,
  })
  const rootItems: WorkspaceArrangeItem[] = rootGroups.map(group => ({
    key: group.key,
    kind: 'node',
    id: group.key,
    rect: group.rect,
    createdAt: group.createdAt,
    kindRank: group.kindRank,
    area: group.area,
  }))
  const items: WorkspaceArrangeItem[] = [...spaceItems, ...rootItems]

  const bounding = computeBoundingRect(items.map(item => item.rect))
  if (!bounding) {
    return { nodes, spaces, warnings: [], didChange: false }
  }

  const start = { x: snapDown(bounding.x, grid), y: snapDown(bounding.y, grid) }
  const effectiveWrapWidth = snapDown(wrapWidth, grid)
  const packingGap = Math.round(gap / 2)
  const sectionGap = gap
  const targetAspect = resolveViewportAspectRatio(viewport)
  const relativeSpaceCandidates = resolveCanvasSectionPlacementCandidates({
    items: spaceItems,
    start: { x: 0, y: 0 },
    wrapWidth: effectiveWrapWidth,
    gap: packingGap,
    packing: 'dense',
    targetAspect,
  })
  const semanticGroupGap = resolvedStyle.alignCanonicalSizes
    ? WORKSPACE_CANONICAL_GUTTER_PX
    : packingGap
  const rootFlowItems = createWorkspaceArrangeSemanticFlowItems({
    groups: rootGroups,
    gap: semanticGroupGap,
  })
  const rootFlowArrangeItems: WorkspaceArrangeItem[] = rootFlowItems.map(item => ({
    key: item.id,
    kind: 'node',
    id: item.id,
    rect: { x: 0, y: 0, width: item.width, height: item.height },
    createdAt: null,
    kindRank: 0,
    area: item.width * item.height,
  }))
  const rootFlowWrapWidth = Math.max(
    effectiveWrapWidth,
    rootFlowArrangeItems.length > 0
      ? Math.max(...rootFlowArrangeItems.map(item => item.rect.width))
      : effectiveWrapWidth,
  )
  const relativeRootCandidates = (() => {
    if (!resolvedStyle.alignCanonicalSizes) {
      return resolveCanvasSectionPlacementCandidates({
        items: rootFlowArrangeItems,
        start: { x: 0, y: 0 },
        wrapWidth: rootFlowWrapWidth,
        gap: packingGap,
        targetAspect,
      })
    }

    const MAX_CANONICAL_COLUMNS = 64
    const cell = resolveCanonicalBucketCellSize(canonicalBucket)
    const strideWidth = Math.max(1, cell.width) + WORKSPACE_CANONICAL_GUTTER_PX
    const maxColumnsByWrap = Math.max(
      1,
      Math.floor((effectiveWrapWidth + WORKSPACE_CANONICAL_GUTTER_PX) / strideWidth),
    )
    const wrapWidthCandidates = resolveSectionWrapWidthCandidates({
      items: rootFlowArrangeItems,
      wrapWidth: rootFlowWrapWidth,
      gap: WORKSPACE_CANONICAL_GUTTER_PX,
      targetAspect,
    })
    const maxColumnsByCandidates =
      wrapWidthCandidates.length > 0
        ? Math.max(
            1,
            ...wrapWidthCandidates.map(candidateWrapWidth =>
              Math.floor((candidateWrapWidth + WORKSPACE_CANONICAL_GUTTER_PX) / strideWidth),
            ),
          )
        : maxColumnsByWrap
    const maxRootItemWidth =
      rootFlowArrangeItems.length > 0
        ? Math.max(...rootFlowArrangeItems.map(item => item.rect.width))
        : 0
    const rootTotalArea = rootFlowArrangeItems.reduce(
      (sum, item) => sum + item.rect.width * item.rect.height,
      0,
    )
    const estimatedRootWidth = Math.round(
      Math.sqrt(Math.max(rootTotalArea, maxRootItemWidth * maxRootItemWidth) * targetAspect),
    )
    const rawIdealColumns =
      estimatedRootWidth > 0
        ? Math.max(
            1,
            Math.floor((estimatedRootWidth + WORKSPACE_CANONICAL_GUTTER_PX) / strideWidth),
          )
        : maxColumnsByWrap
    const maxColumnsLimit = Math.min(
      MAX_CANONICAL_COLUMNS,
      Math.max(maxColumnsByWrap, rawIdealColumns, maxColumnsByCandidates),
    )
    const idealColumns = Math.max(1, Math.min(maxColumnsLimit, rawIdealColumns))
    const maxColumnCandidates = new Set<number>([
      1,
      maxColumnsByWrap,
      idealColumns,
      maxColumnsLimit,
    ])

    for (const candidateWrapWidth of wrapWidthCandidates) {
      const maxColumns = Math.max(
        1,
        Math.min(
          maxColumnsLimit,
          Math.floor((candidateWrapWidth + WORKSPACE_CANONICAL_GUTTER_PX) / strideWidth),
        ),
      )
      maxColumnCandidates.add(maxColumns)
    }

    const candidates = [...maxColumnCandidates]
      .sort((left, right) => left - right)
      .map(maxColumns =>
        resolveWorkspaceArrangeSemanticGridPlacements({
          groups: rootGroups,
          start: { x: 0, y: 0 },
          cell,
          gap: WORKSPACE_CANONICAL_GUTTER_PX,
          targetAspect,
          maxColumns,
        }),
      )
      .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null)
      .map(candidate => ({
        placements: new Map([...candidate.placements.entries()]),
        bounding: candidate.bounding,
      }))

    if (candidates.length === 0) {
      return resolveCanvasSectionPlacementCandidates({
        items: rootFlowArrangeItems,
        start: { x: 0, y: 0 },
        wrapWidth: rootFlowWrapWidth,
        gap: packingGap,
        targetAspect,
      })
    }

    return dedupePlacementCandidates(candidates)
  })()
  const bestCanvasLayout = (() => {
    const candidates: Array<{
      spaceCandidate: PlacementCandidate
      rootCandidate: PlacementCandidate
      spacePlacements: Map<string, { x: number; y: number }>
      rootPlacements: Map<string, { x: number; y: number }>
      bounding: Rect
      area: number
      aspectPenalty: number
      composition: 'horizontal' | 'vertical'
    }> = []

    for (const spaceCandidate of relativeSpaceCandidates) {
      const hasSpaces = spaceCandidate.bounding.width > 0 && spaceCandidate.bounding.height > 0

      for (const rootCandidate of relativeRootCandidates) {
        const hasRoots = rootCandidate.bounding.width > 0 && rootCandidate.bounding.height > 0
        const compositions: Array<{
          composition: 'horizontal' | 'vertical'
          rootOffset: { x: number; y: number }
        }> = [
          {
            // Keep spaces above root windows so the canvas reads top-down: spaces then roots.
            composition: 'vertical',
            rootOffset: {
              x: 0,
              y: hasSpaces && hasRoots ? spaceCandidate.bounding.height + sectionGap : 0,
            },
          },
        ]

        for (const { composition, rootOffset } of compositions) {
          const absoluteSpaceCandidate = translatePlacementCandidate(spaceCandidate, start)
          const absoluteRootCandidate = translatePlacementCandidate(rootCandidate, {
            x: start.x + rootOffset.x,
            y: start.y + rootOffset.y,
          })
          const boundingRects = [
            ...(hasSpaces ? [absoluteSpaceCandidate.bounding] : []),
            ...(hasRoots ? [absoluteRootCandidate.bounding] : []),
          ]
          const combinedBounding = computeBoundingRect(boundingRects) ?? {
            x: start.x,
            y: start.y,
            width: 0,
            height: 0,
          }

          candidates.push({
            spaceCandidate,
            rootCandidate,
            spacePlacements: absoluteSpaceCandidate.placements,
            rootPlacements: absoluteRootCandidate.placements,
            bounding: combinedBounding,
            area: combinedBounding.width * combinedBounding.height,
            aspectPenalty: resolveAspectPenalty(
              combinedBounding.height > 0
                ? combinedBounding.width / combinedBounding.height
                : Number.POSITIVE_INFINITY,
              targetAspect,
            ),
            composition,
          })
        }
      }
    }

    return (
      candidates.sort((left, right) => {
        if (Math.abs(left.aspectPenalty - right.aspectPenalty) > SECTION_PACKING_ASPECT_EPSILON) {
          return left.aspectPenalty - right.aspectPenalty
        }

        if (left.area !== right.area) {
          return left.area - right.area
        }

        if (left.bounding.height !== right.bounding.height) {
          return left.bounding.height - right.bounding.height
        }

        return left.bounding.width - right.bounding.width
      })[0] ?? null
    )
  })()
  const spacePlacements =
    bestCanvasLayout?.spacePlacements ?? new Map<string, { x: number; y: number }>()
  const rootPlacements =
    bestCanvasLayout?.rootPlacements ?? new Map<string, { x: number; y: number }>()

  const spaceDeltaById = new Map<string, { dx: number; dy: number }>()
  for (const item of spaceItems) {
    const placed = spacePlacements.get(item.key)
    if (!placed) {
      continue
    }

    const dx = placed.x - item.rect.x
    const dy = placed.y - item.rect.y
    if (dx === 0 && dy === 0) {
      continue
    }

    spaceDeltaById.set(item.id, { dx, dy })
  }

  const nodePlacementById = new Map<string, { x: number; y: number }>()
  const semanticNodePlacements = resolveWorkspaceArrangeSemanticNodePlacements({
    groups: rootGroups,
    groupPlacements: rootPlacements,
    gap: semanticGroupGap,
  })
  for (const [nodeId, placement] of semanticNodePlacements.entries()) {
    nodePlacementById.set(nodeId, placement)
  }

  const owningSpaceIdByNodeId = new Map<string, string>()
  for (const space of fittedSpaces) {
    for (const nodeId of space.nodeIds) {
      if (!owningSpaceIdByNodeId.has(nodeId)) {
        owningSpaceIdByNodeId.set(nodeId, space.id)
      }
    }
  }

  let didChange = false
  const nextNodes = nodesWithStandardSizing.map(node => {
    const rootPlacement = nodePlacementById.get(node.id)
    if (rootPlacement) {
      if (node.position.x === rootPlacement.x && node.position.y === rootPlacement.y) {
        return node
      }

      didChange = true
      return {
        ...node,
        position: { x: rootPlacement.x, y: rootPlacement.y },
      }
    }

    const owningSpaceId = owningSpaceIdByNodeId.get(node.id) ?? null
    const delta = owningSpaceId ? (spaceDeltaById.get(owningSpaceId) ?? null) : null
    if (!delta) {
      return node
    }

    const nextPosition = {
      x: node.position.x + delta.dx,
      y: node.position.y + delta.dy,
    }

    if (node.position.x === nextPosition.x && node.position.y === nextPosition.y) {
      return node
    }

    didChange = true
    return {
      ...node,
      position: nextPosition,
    }
  })

  const didSpaceMove = spaceDeltaById.size > 0
  const nextSpaces = didSpaceMove
    ? fittedSpaces.map(space => {
        if (!space.rect) {
          return space
        }

        const delta = spaceDeltaById.get(space.id)
        if (!delta) {
          return space
        }

        didChange = true
        return {
          ...space,
          rect: {
            ...space.rect,
            x: space.rect.x + delta.dx,
            y: space.rect.y + delta.dy,
          },
        }
      })
    : fittedSpaces

  const didChangeFromFitOrSizing = canonicalSizingNormalized.didChange || didSpaceFitChange
  const spacesOut = didSpaceFitChange || didSpaceMove ? nextSpaces : spaces

  return didChange || didChangeFromFitOrSizing
    ? { nodes: nextNodes, spaces: spacesOut, warnings: [], didChange: true }
    : { nodes, spaces, warnings: [], didChange: false }
}
