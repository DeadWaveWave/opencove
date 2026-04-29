import type { WorkspaceSpaceRect } from '../types'
export { pushAwayLayout, type LayoutDirection, type LayoutItem } from './spaceLayout.pushAway'
export {
  computeSpaceRectFromNodes,
  SPACE_MIN_SIZE,
  SPACE_NODE_PADDING,
} from '@contexts/workspace/domain/workspaceSpaceLayout'

export const SPACE_CORNER_HITBOX_PX = 18
export const SPACE_EDGE_HITBOX_PX = 8

export type SpaceFrameHandle =
  | { kind: 'move' }
  | {
      kind: 'resize'
      edges: Partial<Record<'top' | 'right' | 'bottom' | 'left', true>>
    }

export type SpaceFrameHandleMode = 'auto' | 'region'

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
  if (mode === 'region') {
    if (handle.kind !== 'resize') {
      return handle
    }

    const { left, right, top, bottom } = handle.edges
    const hasHorizontal = Boolean(left || right)
    const hasVertical = Boolean(top || bottom)

    if (hasHorizontal && hasVertical) {
      return handle
    }

    return { kind: 'move' }
  }

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
