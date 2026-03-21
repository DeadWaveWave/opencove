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
  createArrangeItemsForCanvasRootNodes,
  createArrangeItemsForCanvasSpaces,
  type WorkspaceArrangeItem,
} from './workspaceArrange.ordering'
import {
  computeOwnedNodeIdSet,
  resolveArrangeStyle,
  unionSpaceRects,
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
} from './workspaceNodeSizing'
import { resolveBestDenseGridPacking } from './workspaceArrange.gridPacking'

function resolveCanvasSectionPlacements({
  items,
  start,
  wrapWidth,
  gap,
  style,
}: {
  items: WorkspaceArrangeItem[]
  start: { x: number; y: number }
  wrapWidth: number
  gap: number
  style: Required<WorkspaceArrangeStyle>
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

  if (style.layout === 'compact') {
    return resolveDensePacking({
      items: placementItems,
      start,
      wrapWidth: effectiveWrapWidth,
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
    ? resolvedStyle.layout === 'compact'
      ? 'compact'
      : resolveArrangeCanonicalBucket({
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

    const nextRect =
      resolvedStyle.spaceFit === 'grow' ? unionSpaceRects(space.rect, required) : required
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
  const rootItems = createArrangeItemsForCanvasRootNodes({
    nodes: nodesWithStandardSizing,
    spaces: fittedSpaces,
    order: resolvedStyle.order,
  })
  const items = [...spaceItems, ...rootItems]

  const bounding = computeBoundingRect(items.map(item => item.rect))
  if (!bounding) {
    return { nodes, spaces, warnings: [], didChange: false }
  }

  const start = { x: snapDown(bounding.x, grid), y: snapDown(bounding.y, grid) }
  const effectiveWrapWidth = snapDown(wrapWidth, grid)
  const packingGap = resolvedStyle.layout === 'compact' ? 0 : gap
  const sectionGap = gap
  const targetAspect = resolveViewportAspectRatio(viewport)
  const spacePlacements = resolveCanvasSectionPlacements({
    items: spaceItems,
    start,
    wrapWidth: effectiveWrapWidth,
    gap: packingGap,
    style: resolvedStyle,
  })
  const placedSpaceBounding = computePlacedBoundingRect(spaceItems, spacePlacements)
  const rootStart = {
    x: start.x,
    y: placedSpaceBounding
      ? placedSpaceBounding.y + placedSpaceBounding.height + sectionGap
      : start.y,
  }
  const rootPlacements = (() => {
    if (resolvedStyle.layout !== 'compact' || !resolvedStyle.alignCanonicalSizes) {
      return resolveCanvasSectionPlacements({
        items: rootItems,
        start: rootStart,
        wrapWidth: effectiveWrapWidth,
        gap: packingGap,
        style: resolvedStyle,
      })
    }

    const cell = resolveCanonicalBucketCellSize(canonicalBucket)
    const maxColumns = Math.floor(effectiveWrapWidth / Math.max(1, cell.width))
    const packed = resolveBestDenseGridPacking({
      items: rootItems.map(item => ({
        id: item.key,
        colSpan: Math.max(1, Math.round(item.rect.width / cell.width)),
        rowSpan: Math.max(1, Math.round(item.rect.height / cell.height)),
      })),
      start: rootStart,
      cell,
      targetAspect,
      maxColumns,
    })

    if (!packed) {
      return resolveCanvasSectionPlacements({
        items: rootItems,
        start: rootStart,
        wrapWidth: effectiveWrapWidth,
        gap: packingGap,
        style: resolvedStyle,
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
  for (const item of rootItems) {
    const placed = rootPlacements.get(item.key)
    if (!placed) {
      continue
    }

    nodePlacementById.set(item.id, placed)
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
