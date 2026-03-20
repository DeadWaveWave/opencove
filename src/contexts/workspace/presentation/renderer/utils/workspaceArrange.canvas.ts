import type { Node } from '@xyflow/react'
import type { TerminalNodeData, WorkspaceSpaceState } from '../types'
import { computeSpaceRectFromNodes } from './spaceLayout'
import {
  computeBoundingRect,
  resolveDensePacking,
  resolveFlowPacking,
  snapDown,
} from './workspaceArrange.flowPacking'
import { createArrangeItemsForCanvas } from './workspaceArrange.ordering'
import { normalizeWorkspaceNodesToStandardSizing } from './workspaceArrange.standardSizing'
import {
  computeOwnedNodeIdSet,
  resolveArrangeStyle,
  unionSpaceRects,
  WORKSPACE_ARRANGE_GAP_PX,
  WORKSPACE_ARRANGE_GRID_PX,
  type WorkspaceArrangeResult,
  type WorkspaceArrangeStyle,
} from './workspaceArrange.shared'

export function arrangeWorkspaceCanvas({
  nodes,
  spaces,
  wrapWidth,
  style,
  gap = WORKSPACE_ARRANGE_GAP_PX,
  grid = WORKSPACE_ARRANGE_GRID_PX,
}: {
  nodes: Node<TerminalNodeData>[]
  spaces: WorkspaceSpaceState[]
  wrapWidth: number
  style?: WorkspaceArrangeStyle
  gap?: number
  grid?: number
}): WorkspaceArrangeResult {
  const resolvedStyle = resolveArrangeStyle(style)
  const ownedNodeIdSet = computeOwnedNodeIdSet(spaces)
  const rootNodeIdSet = new Set(
    nodes.filter(node => !ownedNodeIdSet.has(node.id)).map(node => node.id),
  )
  const standardSizingNormalized = normalizeWorkspaceNodesToStandardSizing({
    nodes,
    enabled: resolvedStyle.alignStandardSizes,
    nodeIdSet: rootNodeIdSet,
  })
  const nodesWithStandardSizing = standardSizingNormalized.nodes

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

  const items = createArrangeItemsForCanvas({
    nodes: nodesWithStandardSizing,
    spaces: fittedSpaces,
    order: resolvedStyle.order,
  })

  const bounding = computeBoundingRect(items.map(item => item.rect))
  if (!bounding) {
    return { nodes, spaces, warnings: [], didChange: false }
  }

  const start = { x: snapDown(bounding.x, grid), y: snapDown(bounding.y, grid) }
  const effectiveWrapWidth = snapDown(wrapWidth, grid)
  const effectiveGap = resolvedStyle.dense ? 0 : gap
  const placementItems = items.map(item => ({
    id: item.key,
    width: item.rect.width,
    height: item.rect.height,
  }))
  const placements = resolvedStyle.dense
    ? resolveDensePacking({
        items: placementItems,
        start,
        wrapWidth: effectiveWrapWidth,
      })
    : resolveFlowPacking({
        items: placementItems,
        start,
        wrapWidth: effectiveWrapWidth,
        gap: effectiveGap,
      })

  const spaceDeltaById = new Map<string, { dx: number; dy: number }>()
  for (const item of items) {
    if (item.kind !== 'space') {
      continue
    }

    const placed = placements.get(item.key)
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
  for (const item of items) {
    if (item.kind !== 'node') {
      continue
    }

    const placed = placements.get(item.key)
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

  const didChangeFromFitOrSizing = standardSizingNormalized.didChange || didSpaceFitChange
  const spacesOut = didSpaceFitChange || didSpaceMove ? nextSpaces : spaces

  return didChange || didChangeFromFitOrSizing
    ? { nodes: nextNodes, spaces: spacesOut, warnings: [], didChange: true }
    : { nodes, spaces, warnings: [], didChange: false }
}
