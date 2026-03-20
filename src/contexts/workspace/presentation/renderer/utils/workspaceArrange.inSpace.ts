import type { Node } from '@xyflow/react'
import type { TerminalNodeData, WorkspaceSpaceState } from '../types'
import { computeSpaceRectFromNodes } from './spaceLayout'
import {
  computeBoundingRect,
  resolveDensePacking,
  resolveBoundedFlowPacking,
  resolveFlowPacking,
  type Rect,
} from './workspaceArrange.flowPacking'
import { createArrangeItemsForSpaceNodes } from './workspaceArrange.ordering'
import { normalizeWorkspaceNodesToStandardSizing } from './workspaceArrange.standardSizing'
import {
  resolveArrangeStyle,
  unionSpaceRects,
  WORKSPACE_ARRANGE_GAP_PX,
  WORKSPACE_ARRANGE_PADDING_PX,
  type WorkspaceArrangeResult,
  type WorkspaceArrangeStyle,
} from './workspaceArrange.shared'

export function arrangeWorkspaceInSpace({
  spaceId,
  nodes,
  spaces,
  style,
  padding = WORKSPACE_ARRANGE_PADDING_PX,
  gap = WORKSPACE_ARRANGE_GAP_PX,
}: {
  spaceId: string
  nodes: Node<TerminalNodeData>[]
  spaces: WorkspaceSpaceState[]
  style?: WorkspaceArrangeStyle
  padding?: number
  gap?: number
}): WorkspaceArrangeResult {
  const resolvedStyle = resolveArrangeStyle(style)
  const targetSpace = spaces.find(space => space.id === spaceId) ?? null
  if (!targetSpace) {
    return { nodes, spaces, warnings: [], didChange: false }
  }

  const nodeById = new Map(nodes.map(node => [node.id, node]))
  const ownedNodes = targetSpace.nodeIds
    .map(nodeId => nodeById.get(nodeId))
    .filter((node): node is Node<TerminalNodeData> => Boolean(node))

  if (ownedNodes.length === 0) {
    return { nodes, spaces, warnings: [], didChange: false }
  }

  const standardSizingNormalized = normalizeWorkspaceNodesToStandardSizing({
    nodes,
    enabled: resolvedStyle.alignStandardSizes,
    nodeIdSet: new Set(ownedNodes.map(node => node.id)),
  })

  const normalizedNodes = standardSizingNormalized.nodes
  const normalizedNodeById = standardSizingNormalized.didChange
    ? new Map(normalizedNodes.map(node => [node.id, node]))
    : nodeById
  const normalizedOwnedNodes = targetSpace.nodeIds
    .map(nodeId => normalizedNodeById.get(nodeId))
    .filter((node): node is Node<TerminalNodeData> => Boolean(node))

  const resolvedSpaceRect =
    targetSpace.rect ??
    computeSpaceRectFromNodes(
      normalizedOwnedNodes.map(node => ({
        x: node.position.x,
        y: node.position.y,
        width: node.data.width,
        height: node.data.height,
      })),
    )

  const innerRect: Rect = {
    x: resolvedSpaceRect.x + padding,
    y: resolvedSpaceRect.y + padding,
    width: resolvedSpaceRect.width - padding * 2,
    height: resolvedSpaceRect.height - padding * 2,
  }

  const effectiveGap = resolvedStyle.dense ? 0 : gap
  const items = createArrangeItemsForSpaceNodes({
    nodes: normalizedOwnedNodes,
    order: resolvedStyle.order,
  })

  const maxItemWidth = Math.max(...items.map(item => item.width))
  const wrapWidth = Math.max(innerRect.width, maxItemWidth)
  const start = { x: innerRect.x, y: innerRect.y }

  const placements = (() => {
    if (resolvedStyle.spaceFit === 'keep') {
      if (items.some(item => item.width > innerRect.width || item.height > innerRect.height)) {
        return null
      }

      if (resolvedStyle.dense) {
        const packed = resolveDensePacking({ items, start, wrapWidth: innerRect.width })
        const rects: Rect[] = []
        for (const item of items) {
          const placement = packed.get(item.id)
          if (!placement) {
            continue
          }

          rects.push({
            x: placement.x,
            y: placement.y,
            width: item.width,
            height: item.height,
          })
        }

        const bounding = computeBoundingRect(rects)
        if (!bounding) {
          return packed
        }

        const fitsHeight = bounding.y + bounding.height <= innerRect.y + innerRect.height
        return fitsHeight ? packed : null
      }

      return resolveBoundedFlowPacking({
        items,
        bounds: innerRect,
        gap: effectiveGap,
      })
    }

    if (resolvedStyle.dense) {
      return resolveDensePacking({ items, start, wrapWidth })
    }

    return resolveFlowPacking({
      items,
      start,
      wrapWidth,
      gap: effectiveGap,
    })
  })()

  if (!placements) {
    return {
      nodes,
      spaces,
      warnings: [{ kind: 'space_no_room', spaceId }],
      didChange: false,
    }
  }

  let didChange = false
  const nextNodes = normalizedNodes.map(node => {
    const placement = placements.get(node.id)
    if (!placement) {
      return node
    }

    if (node.position.x === placement.x && node.position.y === placement.y) {
      return node
    }

    didChange = true
    return {
      ...node,
      position: {
        x: placement.x,
        y: placement.y,
      },
    }
  })

  const nextSpaceRect = (() => {
    if (resolvedStyle.spaceFit === 'keep') {
      return resolvedSpaceRect
    }

    const placedById = new Map(nextNodes.map(node => [node.id, node]))
    const placedOwnedNodes = targetSpace.nodeIds
      .map(nodeId => placedById.get(nodeId))
      .filter((node): node is Node<TerminalNodeData> => Boolean(node))

    const required = computeSpaceRectFromNodes(
      placedOwnedNodes.map(node => ({
        x: node.position.x,
        y: node.position.y,
        width: node.data.width,
        height: node.data.height,
      })),
    )

    if (resolvedStyle.spaceFit === 'grow') {
      return unionSpaceRects(resolvedSpaceRect, required)
    }

    return required
  })()

  const nextSpaces =
    targetSpace.rect &&
    nextSpaceRect.x === targetSpace.rect.x &&
    nextSpaceRect.y === targetSpace.rect.y &&
    nextSpaceRect.width === targetSpace.rect.width &&
    nextSpaceRect.height === targetSpace.rect.height
      ? spaces
      : spaces.map(space =>
          space.id === spaceId
            ? {
                ...space,
                rect: nextSpaceRect,
              }
            : space,
        )

  if (nextSpaces !== spaces) {
    didChange = true
  }

  return didChange || standardSizingNormalized.didChange
    ? { nodes: nextNodes, spaces: nextSpaces, warnings: [], didChange: true }
    : { nodes, spaces, warnings: [], didChange: false }
}
