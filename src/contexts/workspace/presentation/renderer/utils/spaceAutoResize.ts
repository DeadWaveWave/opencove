import type { WorkspaceSpaceRect, WorkspaceSpaceState } from '../types'
import {
  pushAwayLayout,
  SPACE_MIN_SIZE,
  SPACE_NODE_PADDING,
  type LayoutDirection,
  type LayoutItem,
} from './spaceLayout'
import {
  buildDirectChildSpaceIdsByParentId,
  buildOwningSpaceIdByNodeId,
  buildSpaceById,
  buildSpaceTreeGroupIdResolver,
  resolveAncestorSpaceIds,
  resolveSpaceRootId,
} from './spaceTreeLayout'

function rectEquals(a: WorkspaceSpaceRect, b: WorkspaceSpaceRect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}

function rectsIntersect(a: WorkspaceSpaceRect, b: WorkspaceSpaceRect): boolean {
  const aRight = a.x + a.width
  const aBottom = a.y + a.height
  const bRight = b.x + b.width
  const bBottom = b.y + b.height

  return !(aRight <= b.x || a.x >= bRight || aBottom <= b.y || a.y >= bBottom)
}

function buildGroupBounds(items: LayoutItem[]): Map<string, WorkspaceSpaceRect> {
  const boundsByGroupId = new Map<string, WorkspaceSpaceRect>()

  for (const item of items) {
    const existing = boundsByGroupId.get(item.groupId)
    const itemRight = item.rect.x + item.rect.width
    const itemBottom = item.rect.y + item.rect.height

    if (!existing) {
      boundsByGroupId.set(item.groupId, { ...item.rect })
      continue
    }

    const nextLeft = Math.min(existing.x, item.rect.x)
    const nextTop = Math.min(existing.y, item.rect.y)
    const nextRight = Math.max(existing.x + existing.width, itemRight)
    const nextBottom = Math.max(existing.y + existing.height, itemBottom)

    boundsByGroupId.set(item.groupId, {
      x: nextLeft,
      y: nextTop,
      width: nextRight - nextLeft,
      height: nextBottom - nextTop,
    })
  }

  return boundsByGroupId
}

function computePaddedBounds(
  rects: WorkspaceSpaceRect[],
  padding: number,
): WorkspaceSpaceRect | null {
  if (rects.length === 0) {
    return null
  }

  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (const rect of rects) {
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
    return null
  }

  return {
    x: minX - padding,
    y: minY - padding,
    width: maxX - minX + padding * 2,
    height: maxY - minY + padding * 2,
  }
}

function expandRectToFit(
  existingRect: WorkspaceSpaceRect,
  requiredRect: WorkspaceSpaceRect,
): WorkspaceSpaceRect {
  const nextLeft = Math.min(existingRect.x, requiredRect.x)
  const nextTop = Math.min(existingRect.y, requiredRect.y)
  const nextRight = Math.max(
    existingRect.x + existingRect.width,
    requiredRect.x + requiredRect.width,
  )
  const nextBottom = Math.max(
    existingRect.y + existingRect.height,
    requiredRect.y + requiredRect.height,
  )

  return {
    x: nextLeft,
    y: nextTop,
    width: Math.max(SPACE_MIN_SIZE.width, nextRight - nextLeft),
    height: Math.max(SPACE_MIN_SIZE.height, nextBottom - nextTop),
  }
}

function resolveSpaceContentRects({
  space,
  nodeRectById,
  spaceRectById,
  directChildSpaceIdsByParentId,
}: {
  space: WorkspaceSpaceState
  nodeRectById: Map<string, WorkspaceSpaceRect>
  spaceRectById: Map<string, WorkspaceSpaceRect>
  directChildSpaceIdsByParentId: Map<string, string[]>
}): WorkspaceSpaceRect[] {
  const rects: WorkspaceSpaceRect[] = []

  for (const nodeId of space.nodeIds) {
    const rect = nodeRectById.get(nodeId)
    if (rect) {
      rects.push(rect)
    }
  }

  for (const childSpaceId of directChildSpaceIdsByParentId.get(space.id) ?? []) {
    const rect = spaceRectById.get(childSpaceId)
    if (rect) {
      rects.push(rect)
    }
  }

  return rects
}

function resolveResizeDirections(
  previousRect: WorkspaceSpaceRect,
  nextRect: WorkspaceSpaceRect,
): LayoutDirection[] {
  const expandedDirections: LayoutDirection[] = []
  if (nextRect.x < previousRect.x) {
    expandedDirections.push('x-')
  }
  if (nextRect.x + nextRect.width > previousRect.x + previousRect.width) {
    expandedDirections.push('x+')
  }
  if (nextRect.y < previousRect.y) {
    expandedDirections.push('y-')
  }
  if (nextRect.y + nextRect.height > previousRect.y + previousRect.height) {
    expandedDirections.push('y+')
  }

  return expandedDirections.length > 0 ? expandedDirections : ['x+']
}

function buildSpaceTreeLayoutItems({
  spaces,
  nodeRects,
  owningSpaceIdByNodeId,
}: {
  spaces: WorkspaceSpaceState[]
  nodeRects: Array<{ id: string; rect: WorkspaceSpaceRect }>
  owningSpaceIdByNodeId: Map<string, string>
}): LayoutItem[] {
  const resolveSpaceGroupId = buildSpaceTreeGroupIdResolver(spaces)
  const items: LayoutItem[] = []

  for (const space of spaces) {
    if (!space.rect) {
      continue
    }

    items.push({
      id: space.id,
      kind: 'space',
      groupId: resolveSpaceGroupId(space.id),
      rect: { ...space.rect },
    })
  }

  for (const nodeItem of nodeRects) {
    const ownerSpaceId = owningSpaceIdByNodeId.get(nodeItem.id) ?? null
    items.push({
      id: nodeItem.id,
      kind: 'node',
      groupId: ownerSpaceId ? resolveSpaceGroupId(ownerSpaceId) : `node:${nodeItem.id}`,
      rect: { ...nodeItem.rect },
    })
  }

  return items
}

export function expandSpaceToFitOwnedNodesAndPushAway({
  targetSpaceId,
  spaces,
  nodeRects,
  gap,
  padding = SPACE_NODE_PADDING,
}: {
  targetSpaceId: string
  spaces: WorkspaceSpaceState[]
  nodeRects: Array<{ id: string; rect: WorkspaceSpaceRect }>
  gap: number
  padding?: number
}): { spaces: WorkspaceSpaceState[]; nodePositionById: Map<string, { x: number; y: number }> } {
  const targetSpace = spaces.find(space => space.id === targetSpaceId)
  if (!targetSpace?.rect) {
    return { spaces, nodePositionById: new Map() }
  }

  const spaceById = buildSpaceById(spaces)
  const directChildSpaceIdsByParentId = buildDirectChildSpaceIdsByParentId(spaces)
  const nodeRectById = new Map(nodeRects.map(item => [item.id, item.rect]))
  const ownedRects = targetSpace.nodeIds
    .map(nodeId => nodeRectById.get(nodeId))
    .filter((rect): rect is WorkspaceSpaceRect => Boolean(rect))

  if (ownedRects.length === 0) {
    return { spaces, nodePositionById: new Map() }
  }

  const spaceRectById = new Map(
    spaces.flatMap(space => (space.rect ? [[space.id, { ...space.rect }] as const] : [])),
  )
  const changedSpaceIds = new Set<string>()

  for (const spaceId of resolveAncestorSpaceIds(targetSpaceId, spaceById)) {
    const space = spaceById.get(spaceId)
    const existingRect = spaceRectById.get(spaceId)
    if (!space || !existingRect) {
      continue
    }

    const requiredRect = computePaddedBounds(
      resolveSpaceContentRects({
        space,
        nodeRectById,
        spaceRectById,
        directChildSpaceIdsByParentId,
      }),
      padding,
    )
    if (!requiredRect) {
      continue
    }

    const expandedRect = expandRectToFit(existingRect, requiredRect)
    if (rectEquals(existingRect, expandedRect)) {
      continue
    }

    spaceRectById.set(spaceId, expandedRect)
    changedSpaceIds.add(spaceId)
  }

  if (changedSpaceIds.size === 0) {
    return { spaces, nodePositionById: new Map() }
  }

  const draftSpaces = spaces.map(space =>
    changedSpaceIds.has(space.id)
      ? {
          ...space,
          rect: spaceRectById.get(space.id) ?? space.rect,
        }
      : space,
  )

  const targetRootSpaceId = resolveSpaceRootId(targetSpaceId, spaceById)
  const previousRootRect = targetRootSpaceId
    ? (spaces.find(space => space.id === targetRootSpaceId)?.rect ?? null)
    : null
  const nextRootRect = targetRootSpaceId
    ? (draftSpaces.find(space => space.id === targetRootSpaceId)?.rect ?? null)
    : null
  if (!previousRootRect || !nextRootRect || rectEquals(previousRootRect, nextRootRect)) {
    return { spaces: draftSpaces, nodePositionById: new Map() }
  }

  const directions = resolveResizeDirections(previousRootRect, nextRootRect)
  const owningSpaceIdByNodeId = buildOwningSpaceIdByNodeId(draftSpaces)
  const items = buildSpaceTreeLayoutItems({
    spaces: draftSpaces,
    nodeRects,
    owningSpaceIdByNodeId,
  })
  const targetRootGroupId = `space:${targetRootSpaceId}`

  const groupBoundsById = buildGroupBounds(items)
  const targetGroupBounds = groupBoundsById.get(targetRootGroupId) ?? null
  const hasExternalCollision =
    targetGroupBounds !== null &&
    [...groupBoundsById.entries()].some(([groupId, rect]) => {
      if (groupId === targetRootGroupId) {
        return false
      }

      return rectsIntersect(targetGroupBounds, rect)
    })

  if (!hasExternalCollision) {
    return { spaces: draftSpaces, nodePositionById: new Map() }
  }

  const pushed = pushAwayLayout({
    items,
    pinnedGroupIds: [targetRootGroupId],
    sourceGroupIds: [targetRootGroupId],
    directions,
    gap,
  })

  const nextSpaceRectById = new Map(
    pushed.filter(item => item.kind === 'space').map(item => [item.id, item.rect]),
  )
  const nextNodePositionById = new Map<string, { x: number; y: number }>()
  pushed.forEach(item => {
    if (item.kind !== 'node') {
      return
    }

    nextNodePositionById.set(item.id, { x: item.rect.x, y: item.rect.y })
  })

  const nextSpaces = draftSpaces.map(space => {
    const rect = space.rect ? nextSpaceRectById.get(space.id) : null
    if (!rect || !space.rect) {
      return space
    }

    return rectEquals(rect, space.rect) ? space : { ...space, rect }
  })

  for (const space of draftSpaces) {
    if (!space.rect) {
      continue
    }

    const nextRect = nextSpaceRectById.get(space.id)
    if (!nextRect) {
      continue
    }

    const dx = nextRect.x - space.rect.x
    const dy = nextRect.y - space.rect.y
    if (dx === 0 && dy === 0) {
      continue
    }

    for (const nodeId of space.nodeIds) {
      const rect = nodeRectById.get(nodeId)
      if (!rect) {
        continue
      }

      nextNodePositionById.set(nodeId, { x: rect.x + dx, y: rect.y + dy })
    }
  }

  return { spaces: nextSpaces, nodePositionById: nextNodePositionById }
}
