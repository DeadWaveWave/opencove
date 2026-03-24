import type { WorkspaceSpaceRect, WorkspaceSpaceState } from '../types'
import {
  pushAwayLayout,
  SPACE_MIN_SIZE,
  SPACE_NODE_PADDING,
  type LayoutDirection,
  type LayoutItem,
} from './spaceLayout'

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

  const nodeRectById = new Map(nodeRects.map(item => [item.id, item.rect]))
  const ownedRects = targetSpace.nodeIds
    .map(nodeId => nodeRectById.get(nodeId))
    .filter((rect): rect is WorkspaceSpaceRect => Boolean(rect))

  if (ownedRects.length === 0) {
    return { spaces, nodePositionById: new Map() }
  }

  const minX = Math.min(...ownedRects.map(rect => rect.x))
  const minY = Math.min(...ownedRects.map(rect => rect.y))
  const maxX = Math.max(...ownedRects.map(rect => rect.x + rect.width))
  const maxY = Math.max(...ownedRects.map(rect => rect.y + rect.height))

  const requiredRect: WorkspaceSpaceRect = {
    x: minX - padding,
    y: minY - padding,
    width: maxX - minX + padding * 2,
    height: maxY - minY + padding * 2,
  }

  const existingRect = targetSpace.rect
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

  const expandedRect: WorkspaceSpaceRect = {
    x: nextLeft,
    y: nextTop,
    width: Math.max(SPACE_MIN_SIZE.width, nextRight - nextLeft),
    height: Math.max(SPACE_MIN_SIZE.height, nextBottom - nextTop),
  }

  if (rectEquals(existingRect, expandedRect)) {
    return { spaces, nodePositionById: new Map() }
  }

  const draftSpaces = spaces.map(space =>
    space.id === targetSpaceId
      ? {
          ...space,
          rect: expandedRect,
        }
      : space,
  )

  const expandedDirections: LayoutDirection[] = []
  if (expandedRect.x < existingRect.x) {
    expandedDirections.push('x-')
  }
  if (expandedRect.x + expandedRect.width > existingRect.x + existingRect.width) {
    expandedDirections.push('x+')
  }
  if (expandedRect.y < existingRect.y) {
    expandedDirections.push('y-')
  }
  if (expandedRect.y + expandedRect.height > existingRect.y + existingRect.height) {
    expandedDirections.push('y+')
  }

  const directions: LayoutDirection[] = expandedDirections.length > 0 ? expandedDirections : ['x+']

  const owningSpaceIdByNodeId = new Map<string, string>()
  for (const space of draftSpaces) {
    for (const nodeId of space.nodeIds) {
      owningSpaceIdByNodeId.set(nodeId, space.id)
    }
  }

  const items: LayoutItem[] = []
  for (const space of draftSpaces) {
    if (!space.rect) {
      continue
    }

    items.push({
      id: space.id,
      kind: 'space',
      groupId: space.id,
      rect: { ...space.rect },
    })
  }

  for (const nodeItem of nodeRects) {
    const owner = owningSpaceIdByNodeId.get(nodeItem.id)
    items.push({
      id: nodeItem.id,
      kind: 'node',
      groupId: owner ?? nodeItem.id,
      rect: { ...nodeItem.rect },
    })
  }

  const groupBoundsById = buildGroupBounds(items)
  const targetGroupBounds = groupBoundsById.get(targetSpaceId) ?? null
  const hasExternalCollision =
    targetGroupBounds !== null &&
    [...groupBoundsById.entries()].some(([groupId, rect]) => {
      if (groupId === targetSpaceId) {
        return false
      }

      return rectsIntersect(targetGroupBounds, rect)
    })

  if (!hasExternalCollision) {
    return { spaces: draftSpaces, nodePositionById: new Map() }
  }

  const pushed = pushAwayLayout({
    items,
    pinnedGroupIds: [targetSpaceId],
    sourceGroupIds: [targetSpaceId],
    directions,
    gap,
  })

  const nextSpaceRectById = new Map(
    pushed.filter(item => item.kind === 'space').map(item => [item.id, item.rect]),
  )
  const nextNodePositionById = new Map(
    pushed
      .filter(item => item.kind === 'node')
      .map(item => [item.id, { x: item.rect.x, y: item.rect.y }]),
  )

  const nextSpaces = draftSpaces.map(space => {
    const rect = space.rect ? nextSpaceRectById.get(space.id) : null
    if (!rect || !space.rect) {
      return space
    }

    return rectEquals(rect, space.rect) ? space : { ...space, rect }
  })

  return { spaces: nextSpaces, nodePositionById: nextNodePositionById }
}
