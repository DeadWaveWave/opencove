import type { Node } from '@xyflow/react'
import type { Size, TerminalNodeData, WorkspaceSpaceState } from '../types'
import { computeSpaceRectFromNodes } from './spaceLayout'
import {
  resolveBoundedFlowPacking,
  resolveFlowPacking,
  type Rect,
} from './workspaceArrange.flowPacking'
import {
  createWorkspaceArrangeSemanticFlowItems,
  createWorkspaceArrangeSemanticGroups,
  resolveWorkspaceArrangeSemanticGridPlacements,
  resolveWorkspaceArrangeSemanticNodePlacements,
} from './workspaceArrange.semantic'
import { resolveViewportAspectRatio } from './workspaceArrange.viewport'
import {
  resolveArrangeStyle,
  WORKSPACE_ARRANGE_GAP_PX,
  WORKSPACE_ARRANGE_PADDING_PX,
  type WorkspaceArrangeResult,
  type WorkspaceArrangeStyle,
} from './workspaceArrange.shared'
import {
  normalizeWorkspaceNodesToCanonicalSizing,
  resolveArrangeCanonicalBucket,
  resolveCanonicalBucketCellSize,
  WORKSPACE_CANONICAL_GUTTER_PX,
} from './workspaceNodeSizing'

const SPACE_CANONICAL_PACKING_AREA_TOLERANCE = 1.4

function resolvePreferredFlowWrapWidth({
  items,
  targetAspect,
}: {
  items: Array<{ width: number; height: number }>
  targetAspect: number
}): number {
  if (items.length === 0) {
    return 0
  }

  const maxItemWidth = Math.max(...items.map(item => item.width))
  const totalArea = items.reduce((sum, item) => sum + item.width * item.height, 0)
  const safeAspect =
    Number.isFinite(targetAspect) && targetAspect > 0 ? targetAspect : resolveViewportAspectRatio()
  const estimatedWidth = Math.round(
    Math.sqrt(Math.max(totalArea, maxItemWidth * maxItemWidth) * safeAspect),
  )

  return Math.max(maxItemWidth, estimatedWidth)
}

export function arrangeWorkspaceInSpace({
  spaceId,
  nodes,
  spaces,
  viewport,
  style,
  padding = WORKSPACE_ARRANGE_PADDING_PX,
  gap = WORKSPACE_ARRANGE_GAP_PX,
}: {
  spaceId: string
  nodes: Node<TerminalNodeData>[]
  spaces: WorkspaceSpaceState[]
  viewport?: Partial<Size>
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

  const ownedNodeIdSet = new Set(ownedNodes.map(node => node.id))
  const canonicalBucket = resolvedStyle.alignCanonicalSizes
    ? resolveArrangeCanonicalBucket({
        nodes,
        nodeIdSet: ownedNodeIdSet,
        viewport,
      })
    : 'regular'
  const canonicalSizingNormalized = normalizeWorkspaceNodesToCanonicalSizing({
    nodes,
    enabled: resolvedStyle.alignCanonicalSizes,
    nodeIdSet: ownedNodeIdSet,
    bucket: canonicalBucket,
  })

  const normalizedNodes = canonicalSizingNormalized.nodes
  const normalizedNodeById = canonicalSizingNormalized.didChange
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

  const effectiveGap = Math.round(gap / 2)
  const semanticGroups = createWorkspaceArrangeSemanticGroups({
    nodes: normalizedOwnedNodes,
    order: resolvedStyle.order,
  })
  const maxCanonicalColumns = (() => {
    if (!resolvedStyle.alignCanonicalSizes) {
      return undefined
    }

    if (resolvedStyle.spaceFit !== 'keep') {
      return undefined
    }

    const cell = resolveCanonicalBucketCellSize(canonicalBucket)
    const strideWidth = Math.max(1, cell.width) + WORKSPACE_CANONICAL_GUTTER_PX
    return Math.max(1, Math.floor((innerRect.width + WORKSPACE_CANONICAL_GUTTER_PX) / strideWidth))
  })()
  const targetAspect =
    resolvedStyle.spaceFit === 'keep' && innerRect.width > 0 && innerRect.height > 0
      ? innerRect.width / innerRect.height
      : resolveViewportAspectRatio(viewport)

  const start = { x: innerRect.x, y: innerRect.y }
  const semanticGroupGap = resolvedStyle.alignCanonicalSizes
    ? WORKSPACE_CANONICAL_GUTTER_PX
    : effectiveGap
  const semanticFlowItems = createWorkspaceArrangeSemanticFlowItems({
    groups: semanticGroups,
    gap: semanticGroupGap,
  })

  const placements = (() => {
    if (resolvedStyle.spaceFit === 'keep') {
      if (
        semanticFlowItems.some(
          item => item.width > innerRect.width || item.height > innerRect.height,
        )
      ) {
        return null
      }

      if (resolvedStyle.alignCanonicalSizes) {
        const packed = resolveWorkspaceArrangeSemanticGridPlacements({
          groups: semanticGroups,
          start,
          cell: resolveCanonicalBucketCellSize(canonicalBucket),
          gap: WORKSPACE_CANONICAL_GUTTER_PX,
          targetAspect,
          maxColumns: maxCanonicalColumns,
          maxHeight: innerRect.height,
          compactAreaTolerance: SPACE_CANONICAL_PACKING_AREA_TOLERANCE,
        })

        return packed?.placements ?? null
      }

      return resolveBoundedFlowPacking({
        items: semanticFlowItems,
        bounds: innerRect,
        gap: effectiveGap,
      })
    }

    if (resolvedStyle.alignCanonicalSizes) {
      const packed = resolveWorkspaceArrangeSemanticGridPlacements({
        groups: semanticGroups,
        start,
        cell: resolveCanonicalBucketCellSize(canonicalBucket),
        gap: WORKSPACE_CANONICAL_GUTTER_PX,
        targetAspect,
        maxColumns: maxCanonicalColumns,
        compactAreaTolerance: SPACE_CANONICAL_PACKING_AREA_TOLERANCE,
      })

      if (packed) {
        return packed.placements
      }
    }

    const maxItemWidth =
      semanticFlowItems.length > 0 ? Math.max(...semanticFlowItems.map(item => item.width)) : 0
    const wrapWidth = Math.max(
      innerRect.width,
      maxItemWidth,
      resolvePreferredFlowWrapWidth({
        items: semanticFlowItems,
        targetAspect,
      }),
    )

    return resolveFlowPacking({ items: semanticFlowItems, start, wrapWidth, gap: effectiveGap })
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
  const nodePlacements = resolveWorkspaceArrangeSemanticNodePlacements({
    groups: semanticGroups,
    groupPlacements: placements,
    gap: semanticGroupGap,
  })
  const nextNodes = normalizedNodes.map(node => {
    const placement = nodePlacements.get(node.id)
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

  return didChange || canonicalSizingNormalized.didChange
    ? { nodes: nextNodes, spaces: nextSpaces, warnings: [], didChange: true }
    : { nodes, spaces, warnings: [], didChange: false }
}
