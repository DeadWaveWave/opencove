import type { Node } from '@xyflow/react'
import type { Size, TerminalNodeData, WorkspaceSpaceState } from '../types'
import { computeSpaceRectFromNodes } from './spaceLayout'
import {
  computeBoundingRect,
  resolveDensePacking,
  resolveBoundedFlowPacking,
  resolveFlowPacking,
  type Rect,
} from './workspaceArrange.flowPacking'
import { createArrangeItemsForSpaceNodes } from './workspaceArrange.ordering'
import {
  resolveArrangeStyle,
  unionSpaceRects,
  WORKSPACE_ARRANGE_GAP_PX,
  WORKSPACE_ARRANGE_PADDING_PX,
  type WorkspaceArrangeResult,
  type WorkspaceArrangeStyle,
} from './workspaceArrange.shared'
import {
  normalizeWorkspaceNodesToCanonicalSizing,
  resolveArrangeCanonicalBucket,
} from './workspaceNodeSizing'

function resolveViewportAspectRatio(viewport?: Partial<Size>): number {
  const width =
    typeof viewport?.width === 'number' && Number.isFinite(viewport.width) && viewport.width > 0
      ? viewport.width
      : typeof window !== 'undefined' && Number.isFinite(window.innerWidth) && window.innerWidth > 0
        ? window.innerWidth
        : 1440
  const height =
    typeof viewport?.height === 'number' && Number.isFinite(viewport.height) && viewport.height > 0
      ? viewport.height
      : typeof window !== 'undefined' &&
          Number.isFinite(window.innerHeight) &&
          window.innerHeight > 0
        ? window.innerHeight
        : 900

  if (height <= 0) {
    return 16 / 9
  }

  const ratio = width / height
  if (!Number.isFinite(ratio) || ratio <= 0) {
    return 16 / 9
  }

  return ratio
}

function resolveBestCompactDensePacking({
  items,
  start,
  viewport,
  wrapWidthHint,
}: {
  items: Array<{ id: string; width: number; height: number }>
  start: { x: number; y: number }
  viewport?: Partial<Size>
  wrapWidthHint: number
}): Map<string, { x: number; y: number }> {
  if (items.length <= 1) {
    return resolveDensePacking({ items, start, wrapWidth: wrapWidthHint })
  }

  const maxItemWidth = Math.max(...items.map(item => item.width))
  const minWrapWidth = maxItemWidth

  const totalArea = items.reduce((sum, item) => sum + item.width * item.height, 0)
  const targetAspect = resolveViewportAspectRatio(viewport)
  const desiredWrapWidth =
    totalArea > 0 ? Math.max(minWrapWidth, Math.sqrt(totalArea * targetAspect)) : minWrapWidth

  const idealColumns = Math.max(1, Math.round(desiredWrapWidth / maxItemWidth))
  const maxColumns = Math.min(items.length, Math.max(8, idealColumns + 2))

  const columnCandidates = new Set<number>([
    1,
    idealColumns - 2,
    idealColumns - 1,
    idealColumns,
    idealColumns + 1,
    idealColumns + 2,
    Math.round(Math.sqrt(items.length)),
    Math.ceil(items.length / 2),
    items.length,
  ])

  const wrapWidthCandidates = [...columnCandidates]
    .map(columns => Math.max(1, Math.min(maxColumns, columns)))
    .map(columns => Math.max(minWrapWidth, columns * maxItemWidth))

  wrapWidthCandidates.push(minWrapWidth)
  wrapWidthCandidates.push(Math.max(minWrapWidth, wrapWidthHint))
  wrapWidthCandidates.push(Math.max(minWrapWidth, Math.round(desiredWrapWidth)))

  const uniqueCandidates = [...new Set(wrapWidthCandidates)].sort((a, b) => a - b)

  let best: {
    area: number
    aspectDiff: number
    height: number
    width: number
    placements: Map<string, { x: number; y: number }>
  } | null = null

  for (const wrapWidth of uniqueCandidates) {
    const placements = resolveDensePacking({ items, start, wrapWidth })
    const rects: Rect[] = []
    for (const item of items) {
      const placed = placements.get(item.id)
      if (!placed) {
        continue
      }

      rects.push({ x: placed.x, y: placed.y, width: item.width, height: item.height })
    }

    const bounding = computeBoundingRect(rects)
    if (!bounding) {
      continue
    }

    const width = bounding.width
    const height = bounding.height
    const area = width * height
    const aspect = height > 0 ? width / height : Number.POSITIVE_INFINITY
    const aspectDiff = Number.isFinite(aspect) ? Math.abs(aspect - targetAspect) : 0

    const candidate = {
      area,
      aspectDiff,
      width,
      height,
      placements,
    }

    if (!best) {
      best = candidate
      continue
    }

    if (candidate.aspectDiff !== best.aspectDiff) {
      if (candidate.aspectDiff < best.aspectDiff) {
        best = candidate
      }
      continue
    }

    if (candidate.area !== best.area) {
      if (candidate.area < best.area) {
        best = candidate
      }
      continue
    }

    if (candidate.height !== best.height) {
      if (candidate.height < best.height) {
        best = candidate
      }
      continue
    }

    if (candidate.width < best.width) {
      best = candidate
    }
  }

  return best?.placements ?? resolveDensePacking({ items, start, wrapWidth: minWrapWidth })
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
    ? resolvedStyle.layout === 'compact'
      ? 'compact'
      : resolveArrangeCanonicalBucket({
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

  const effectiveGap = resolvedStyle.layout === 'compact' ? 0 : gap
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

      if (resolvedStyle.layout === 'compact') {
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

    if (resolvedStyle.layout === 'compact') {
      return resolveBestCompactDensePacking({
        items,
        start,
        viewport,
        wrapWidthHint: wrapWidth,
      })
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

  return didChange || canonicalSizingNormalized.didChange
    ? { nodes: nextNodes, spaces: nextSpaces, warnings: [], didChange: true }
    : { nodes, spaces, warnings: [], didChange: false }
}
