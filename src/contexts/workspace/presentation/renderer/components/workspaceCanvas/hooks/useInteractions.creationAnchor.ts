import {
  resolveInnermostSpaceAtPoint,
  type SpaceContainmentLike,
} from '@contexts/space/application/spaceContainment'
import type { Point } from '../../../types'
import type { PaneContextMenuState } from '../types'
import { resolveCanvasVisualCenter, type RectLike } from './useShortcuts.helpers'

const VIEWPORT_CENTER_SNAP_RADIUS_PX = 120

// Resolve once at the input boundary, before menus or asynchronous launches can move the viewport.
export function resolvePointerCreationAnchor({
  clientPoint,
  canvasRect,
  screenToFlowPosition,
  spaces,
}: {
  clientPoint: Point
  canvasRect: RectLike | null
  screenToFlowPosition: (point: Point) => Point
  spaces: SpaceContainmentLike[]
}): Point {
  const pointerAnchor = screenToFlowPosition(clientPoint)
  if (!canvasRect || canvasRect.width <= 0 || canvasRect.height <= 0) {
    return pointerAnchor
  }

  const center = resolveCanvasVisualCenter(canvasRect)
  if (
    Math.hypot(clientPoint.x - center.x, clientPoint.y - center.y) > VIEWPORT_CENTER_SNAP_RADIUS_PX
  ) {
    return pointerAnchor
  }

  const centerAnchor = screenToFlowPosition(center)
  const pointerSpace = resolveInnermostSpaceAtPoint(spaces, pointerAnchor)
  const centerSpace = resolveInnermostSpaceAtPoint(spaces, centerAnchor)
  // Snapping must never change the launch directory or space ownership.
  return pointerSpace?.id === centerSpace?.id ? centerAnchor : pointerAnchor
}

export function resolvePaneNodeCreationAnchor(contextMenu: PaneContextMenuState): Point {
  return contextMenu.creationAnchor ?? { x: contextMenu.flowX, y: contextMenu.flowY }
}
