import type { Node } from '@xyflow/react'
import type { Size, TerminalNodeData, WorkspaceSpaceState } from '../types'
import { computeSpaceRectFromNodes } from './spaceLayout'
import {
  computeBoundingRect,
  resolveDensePacking,
  resolveFlowPacking,
  snapDown,
} from './workspaceArrange.flowPacking'
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
  resolveArrangeCanonicalBucket,
  resolveCanonicalBucketCellSize,
  WORKSPACE_CANONICAL_GUTTER_PX,
} from './workspaceNodeSizing'
function resolveCanvasSectionPlacements({
  items,
  start,
  wrapWidth,
  gap,
  packing = 'flow',
}: {
  items: WorkspaceArrangeItem[]
  start: { x: number; y: number }
  wrapWidth: number
  gap: number
  packing?: 'dense' | 'flow'
}): Map<string, { x: number; y: number }> {
  if (items.length === 0) {
    return new Map()
  }

  const placementItems = items.map(item => ({
    id: item.key,
    width: item.rect.width,
    height: item.rect.height,
  }))
  const effectiveWrapWidth = Math.max(
    wrapWidth,
    Math.max(...placementItems.map(item => item.width)),
  )

  if (packing === 'dense') {
    return resolveDensePacking({
      items: placementItems,
      start,
      wrapWidth: effectiveWrapWidth,
      gap,
    })
  }

  return resolveFlowPacking({
    items: placementItems,
    start,
    wrapWidth: effectiveWrapWidth,
    gap,
  })
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

export function arrangeWorkspaceCanvas({
  nodes,
  spaces,
  wrapWidth,
  viewport,
  style,
  gap = WORKSPACE_ARRANGE_GAP_PX,
  grid = WORKSPACE_ARRANGE_GRID_PX,
}: {
  nodes: Node<TerminalNodeData>[]
  spaces: WorkspaceSpaceState[]
  wrapWidth: number
  viewport?: Partial<Size>
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
    ? resolveArrangeCanonicalBucket({
        nodes,
        nodeIdSet: rootNodeIdSet,
        viewport,
      })
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
  const spacePlacements = resolveCanvasSectionPlacements({
    items: spaceItems,
    start,
    wrapWidth: effectiveWrapWidth,
    gap: packingGap,
    packing: 'dense',
  })
  const placedSpaceBounding = computePlacedBoundingRect(spaceItems, spacePlacements)
  const rootStart = {
    x: start.x,
    y: placedSpaceBounding
      ? placedSpaceBounding.y + placedSpaceBounding.height + sectionGap
      : start.y,
  }
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
  const rootPlacements = (() => {
    if (!resolvedStyle.alignCanonicalSizes) {
      const maxItemWidth =
        rootFlowArrangeItems.length > 0
          ? Math.max(...rootFlowArrangeItems.map(item => item.rect.width))
          : 0

      return resolveCanvasSectionPlacements({
        items: rootFlowArrangeItems,
        start: rootStart,
        wrapWidth: Math.max(effectiveWrapWidth, maxItemWidth),
        gap: packingGap,
      })
    }

    const cell = resolveCanonicalBucketCellSize(canonicalBucket)
    const strideWidth = Math.max(1, cell.width) + WORKSPACE_CANONICAL_GUTTER_PX
    const maxColumns = Math.max(
      1,
      Math.floor((effectiveWrapWidth + WORKSPACE_CANONICAL_GUTTER_PX) / strideWidth),
    )
    const packed = resolveWorkspaceArrangeSemanticGridPlacements({
      groups: rootGroups,
      start: rootStart,
      cell,
      gap: WORKSPACE_CANONICAL_GUTTER_PX,
      targetAspect,
      maxColumns,
    })

    if (!packed) {
      const maxItemWidth =
        rootFlowArrangeItems.length > 0
          ? Math.max(...rootFlowArrangeItems.map(item => item.rect.width))
          : 0
      return resolveCanvasSectionPlacements({
        items: rootFlowArrangeItems,
        start: rootStart,
        wrapWidth: Math.max(effectiveWrapWidth, maxItemWidth),
        gap: packingGap,
      })
    }

    return new Map([...packed.placements.entries()])
  })()

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
