import type { WorkspaceSpaceRect } from '../types'

export const SPACE_NODE_PADDING = 24
export const SPACE_MIN_SIZE = { width: 120, height: 100 }
export const SPACE_CORNER_HITBOX_PX = 18
export const SPACE_EDGE_HITBOX_PX = 8

export type SpaceFrameHandle =
  | { kind: 'move' }
  | {
      kind: 'resize'
      edges: Partial<Record<'top' | 'right' | 'bottom' | 'left', true>>
    }

export type SpaceFrameHandleMode = 'auto' | 'region'

export function computeSpaceRectFromNodes(
  nodes: Array<{ x: number; y: number; width: number; height: number }>,
): WorkspaceSpaceRect {
  if (nodes.length === 0) {
    return { x: 0, y: 0, width: SPACE_MIN_SIZE.width, height: SPACE_MIN_SIZE.height }
  }

  const minX = Math.min(...nodes.map(node => node.x))
  const minY = Math.min(...nodes.map(node => node.y))
  const maxX = Math.max(...nodes.map(node => node.x + node.width))
  const maxY = Math.max(...nodes.map(node => node.y + node.height))

  return {
    x: minX - SPACE_NODE_PADDING,
    y: minY - SPACE_NODE_PADDING,
    width: Math.max(SPACE_MIN_SIZE.width, maxX - minX + SPACE_NODE_PADDING * 2),
    height: Math.max(SPACE_MIN_SIZE.height, maxY - minY + SPACE_NODE_PADDING * 2),
  }
}

export function resolveSpaceFrameHandle({
  rect,
  point,
  zoom,
}: {
  rect: WorkspaceSpaceRect
  point: { x: number; y: number }
  zoom: number
}): SpaceFrameHandle {
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1
  const cornerSize = SPACE_CORNER_HITBOX_PX / safeZoom
  const edgeHitbox = SPACE_EDGE_HITBOX_PX / safeZoom

  const localX = point.x - rect.x
  const localY = point.y - rect.y
  const width = rect.width
  const height = rect.height

  if (width <= 0 || height <= 0) {
    return { kind: 'move' }
  }

  if (localX <= cornerSize && localY <= cornerSize) {
    return { kind: 'resize', edges: { left: true, top: true } }
  }

  if (localX >= width - cornerSize && localY <= cornerSize) {
    return { kind: 'resize', edges: { right: true, top: true } }
  }

  if (localX >= width - cornerSize && localY >= height - cornerSize) {
    return { kind: 'resize', edges: { right: true, bottom: true } }
  }

  if (localX <= cornerSize && localY >= height - cornerSize) {
    return { kind: 'resize', edges: { left: true, bottom: true } }
  }

  const distances = [
    { edge: 'left' as const, dist: Math.abs(localX) },
    { edge: 'right' as const, dist: Math.abs(width - localX) },
    { edge: 'top' as const, dist: Math.abs(localY) },
    { edge: 'bottom' as const, dist: Math.abs(height - localY) },
  ]

  distances.sort((a, b) => a.dist - b.dist)
  const closestEdge = distances[0]?.edge ?? 'top'
  const closestEdgeDist = distances[0]?.dist ?? Number.POSITIVE_INFINITY

  if (closestEdgeDist > edgeHitbox) {
    return { kind: 'move' }
  }

  if (closestEdge === 'top') {
    return { kind: 'move' }
  }

  return { kind: 'resize', edges: { [closestEdge]: true } }
}

export function applySpaceFrameHandleMode(
  handle: SpaceFrameHandle,
  mode: SpaceFrameHandleMode = 'auto',
): SpaceFrameHandle {
  void mode
  return handle
}

export function resolveInteractiveSpaceFrameHandle({
  rect,
  point,
  zoom,
  mode = 'auto',
}: {
  rect: WorkspaceSpaceRect
  point: { x: number; y: number }
  zoom: number
  mode?: SpaceFrameHandleMode
}): SpaceFrameHandle {
  return applySpaceFrameHandleMode(resolveSpaceFrameHandle({ rect, point, zoom }), mode)
}

export function getSpaceFrameHandleCursor(handle: SpaceFrameHandle): string {
  if (handle.kind !== 'resize') {
    return 'grab'
  }

  const { left, right, top, bottom } = handle.edges
  if ((left && top) || (right && bottom)) {
    return 'nwse-resize'
  }

  if ((right && top) || (left && bottom)) {
    return 'nesw-resize'
  }

  if (left || right) {
    return 'ew-resize'
  }

  if (top || bottom) {
    return 'ns-resize'
  }

  return 'grab'
}

export type LayoutDirection = 'x+' | 'x-' | 'y+' | 'y-'

export interface LayoutItem {
  id: string
  kind: 'node' | 'space'
  groupId: string
  rect: WorkspaceSpaceRect
}

export function pushAwayLayout(_input: {
  items: LayoutItem[]
  pinnedGroupIds: string[]
  sourceGroupIds: string[]
  directions: LayoutDirection[]
  gap: number
}): LayoutItem[] {
  const nextItems: LayoutItem[] = _input.items.map(item => ({
    ...item,
    rect: { ...item.rect },
  }))

  const groupIndices = new Map<string, number[]>()
  nextItems.forEach((item, index) => {
    const existing = groupIndices.get(item.groupId)
    if (existing) {
      existing.push(index)
      return
    }

    groupIndices.set(item.groupId, [index])
  })

  const pinned = new Set(_input.pinnedGroupIds)
  const groupIds = [...groupIndices.keys()]

  const intersects = (a: WorkspaceSpaceRect, b: WorkspaceSpaceRect): boolean => {
    const aRight = a.x + a.width
    const aBottom = a.y + a.height
    const bRight = b.x + b.width
    const bBottom = b.y + b.height

    return !(aRight <= b.x || a.x >= bRight || aBottom <= b.y || a.y >= bBottom)
  }

  const moveGroupBy = (groupId: string, dx: number, dy: number): void => {
    const indices = groupIndices.get(groupId)
    if (!indices) {
      return
    }

    indices.forEach(index => {
      const item = nextItems[index]
      item.rect.x += dx
      item.rect.y += dy
    })
  }

  const hasGroupIntersection = (sourceGroupId: string, targetGroupId: string): boolean => {
    const sourceIndices = groupIndices.get(sourceGroupId)
    const targetIndices = groupIndices.get(targetGroupId)
    if (!sourceIndices || !targetIndices) {
      return false
    }

    for (const sourceIndex of sourceIndices) {
      const sourceRect = nextItems[sourceIndex]?.rect
      if (!sourceRect) {
        continue
      }

      for (const targetIndex of targetIndices) {
        const targetRect = nextItems[targetIndex]?.rect
        if (!targetRect) {
          continue
        }

        if (intersects(sourceRect, targetRect)) {
          return true
        }
      }
    }

    return false
  }

  const computePushDelta = (
    sourceGroupId: string,
    targetGroupId: string,
    direction: LayoutDirection,
    gap: number,
  ): { dx: number; dy: number } => {
    const sourceIndices = groupIndices.get(sourceGroupId)
    const targetIndices = groupIndices.get(targetGroupId)
    if (!sourceIndices || !targetIndices) {
      return { dx: 0, dy: 0 }
    }

    if (direction === 'x+') {
      let dx = 0
      for (const sourceIndex of sourceIndices) {
        const sourceRect = nextItems[sourceIndex]?.rect
        if (!sourceRect) {
          continue
        }

        const sourceRight = sourceRect.x + sourceRect.width
        for (const targetIndex of targetIndices) {
          const targetRect = nextItems[targetIndex]?.rect
          if (!targetRect) {
            continue
          }

          if (!intersects(sourceRect, targetRect)) {
            continue
          }

          dx = Math.max(dx, sourceRight + gap - targetRect.x)
        }
      }

      return { dx, dy: 0 }
    }

    if (direction === 'x-') {
      let dx = 0
      for (const sourceIndex of sourceIndices) {
        const sourceRect = nextItems[sourceIndex]?.rect
        if (!sourceRect) {
          continue
        }

        for (const targetIndex of targetIndices) {
          const targetRect = nextItems[targetIndex]?.rect
          if (!targetRect) {
            continue
          }

          if (!intersects(sourceRect, targetRect)) {
            continue
          }

          const targetRight = targetRect.x + targetRect.width
          dx = Math.min(dx, sourceRect.x - gap - targetRight)
        }
      }

      return { dx, dy: 0 }
    }

    if (direction === 'y+') {
      let dy = 0
      for (const sourceIndex of sourceIndices) {
        const sourceRect = nextItems[sourceIndex]?.rect
        if (!sourceRect) {
          continue
        }

        const sourceBottom = sourceRect.y + sourceRect.height
        for (const targetIndex of targetIndices) {
          const targetRect = nextItems[targetIndex]?.rect
          if (!targetRect) {
            continue
          }

          if (!intersects(sourceRect, targetRect)) {
            continue
          }

          dy = Math.max(dy, sourceBottom + gap - targetRect.y)
        }
      }

      return { dx: 0, dy }
    }

    let dy = 0
    for (const sourceIndex of sourceIndices) {
      const sourceRect = nextItems[sourceIndex]?.rect
      if (!sourceRect) {
        continue
      }

      for (const targetIndex of targetIndices) {
        const targetRect = nextItems[targetIndex]?.rect
        if (!targetRect) {
          continue
        }

        if (!intersects(sourceRect, targetRect)) {
          continue
        }

        const targetBottom = targetRect.y + targetRect.height
        dy = Math.min(dy, sourceRect.y - gap - targetBottom)
      }
    }

    return { dx: 0, dy }
  }

  const initialQueueForDirection = (_direction: LayoutDirection): string[] => {
    const ordered = _input.sourceGroupIds.filter(groupId => groupIndices.has(groupId))

    if (ordered.length > 0) {
      return ordered
    }

    const fallback = groupIds.find(groupId => pinned.has(groupId))
    return fallback ? [fallback] : []
  }

  for (const direction of _input.directions) {
    const queue = initialQueueForDirection(direction)
    const inQueue = new Set(queue)

    const maxIterations = Math.max(20, groupIds.length * groupIds.length * 4)
    let iterations = 0

    while (queue.length > 0 && iterations < maxIterations) {
      iterations += 1
      const sourceGroupId = queue.shift()
      if (!sourceGroupId) {
        break
      }
      inQueue.delete(sourceGroupId)

      for (const targetGroupId of groupIds) {
        if (targetGroupId === sourceGroupId) {
          continue
        }

        if (pinned.has(targetGroupId)) {
          continue
        }

        if (!hasGroupIntersection(sourceGroupId, targetGroupId)) {
          continue
        }

        const { dx, dy } = computePushDelta(sourceGroupId, targetGroupId, direction, _input.gap)
        if (dx === 0 && dy === 0) {
          continue
        }

        moveGroupBy(targetGroupId, dx, dy)

        if (!inQueue.has(targetGroupId)) {
          queue.push(targetGroupId)
          inQueue.add(targetGroupId)
        }

        for (const pinnedGroupId of pinned) {
          if (!groupIndices.has(pinnedGroupId)) {
            continue
          }

          if (!hasGroupIntersection(pinnedGroupId, targetGroupId)) {
            continue
          }

          if (!inQueue.has(pinnedGroupId)) {
            queue.push(pinnedGroupId)
            inQueue.add(pinnedGroupId)
          }
        }
      }
    }
  }

  return nextItems
}
