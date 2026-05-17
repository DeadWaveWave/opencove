import { SPACE_NODE_PADDING } from './workspaceSpaceLayout'
import {
  containsRect,
  findCanvasOverflowPosition,
  findNearestFreeAnchorWithinBounds,
  findNearestFreePosition,
  findNearestFreePositionAroundBounds,
  findNearestFreePositionWithinBounds,
  inflateRect,
  isPositionAvailable,
  resolvePreferredDirections,
  toRectBounds,
  type NodePlacementDirection,
  type Point,
  type Rect,
  type Size,
  type WorkspacePlacementNode,
} from './workspaceNodePlacementGeometry'

export { inflateRect, isPositionAvailable }
export type { NodePlacementDirection, Point, Rect, Size, WorkspacePlacementNode }

export function resolveWorkspaceNodesPlacement({
  anchor,
  size,
  nodes,
  spaceRects,
  targetSpaceRect,
  preferredDirection,
  avoidRects,
}: {
  anchor: Point
  size: Size
  nodes: WorkspacePlacementNode[]
  spaceRects?: Array<{ x: number; y: number; width: number; height: number }>
  targetSpaceRect?: { x: number; y: number; width: number; height: number } | null
  preferredDirection?: NodePlacementDirection
  avoidRects?: Array<{ x: number; y: number; width: number; height: number }>
}): { placement: Point; canPlace: boolean } {
  const spaceObstacles = (spaceRects ?? []).map(rect =>
    inflateRect(toRectBounds(rect), SPACE_NODE_PADDING),
  )
  const avoidObstacles = (avoidRects ?? []).map(rect => toRectBounds(rect))
  const targetObstacle = targetSpaceRect
    ? inflateRect(toRectBounds(targetSpaceRect), SPACE_NODE_PADDING)
    : null
  const obstacleEquals = (a: Rect, b: Rect): boolean =>
    a.left === b.left && a.top === b.top && a.right === b.right && a.bottom === b.bottom
  const targetHasContainingSpace = targetObstacle
    ? spaceObstacles.some(
        obstacle =>
          !obstacleEquals(obstacle, targetObstacle) && containsRect(obstacle, targetObstacle),
      )
    : false
  const obstaclesExceptTarget = targetObstacle
    ? spaceObstacles.filter(
        obstacle =>
          !obstacleEquals(obstacle, targetObstacle) && !containsRect(obstacle, targetObstacle),
      )
    : spaceObstacles

  const combinedSpaceObstacles = avoidObstacles.length
    ? [...spaceObstacles, ...avoidObstacles]
    : spaceObstacles
  const combinedObstaclesExceptTarget = avoidObstacles.length
    ? [...obstaclesExceptTarget, ...avoidObstacles]
    : obstaclesExceptTarget

  if (!targetSpaceRect) {
    if (isPositionAvailable(anchor, size, nodes, undefined, combinedSpaceObstacles)) {
      return { placement: anchor, canPlace: true }
    }
  }

  if (targetSpaceRect) {
    const targetBounds = toRectBounds(targetSpaceRect)
    const targetContentBounds = {
      left: targetSpaceRect.x + SPACE_NODE_PADDING,
      top: targetSpaceRect.y + SPACE_NODE_PADDING,
      right: targetSpaceRect.x + targetSpaceRect.width - SPACE_NODE_PADDING,
      bottom: targetSpaceRect.y + targetSpaceRect.height - SPACE_NODE_PADDING,
    }
    const targetAnchorBounds =
      targetContentBounds.left <= targetContentBounds.right &&
      targetContentBounds.top <= targetContentBounds.bottom
        ? targetContentBounds
        : targetBounds

    const boundedPlacement = findNearestFreePositionWithinBounds(
      anchor,
      size,
      targetContentBounds,
      nodes,
      undefined,
      combinedObstaclesExceptTarget,
    )

    if (boundedPlacement) {
      return { placement: boundedPlacement, canPlace: true }
    }

    const scopedPlacement = findNearestFreeAnchorWithinBounds(
      anchor,
      size,
      targetAnchorBounds,
      nodes,
      undefined,
      combinedObstaclesExceptTarget,
    )
    if (scopedPlacement) {
      return { placement: scopedPlacement, canPlace: true }
    }

    if (!targetHasContainingSpace) {
      const aroundSpacePlacement = findNearestFreePositionAroundBounds({
        desired: anchor,
        size,
        bounds: targetBounds,
        allNodes: nodes,
        directions: resolvePreferredDirections({
          anchor,
          size,
          targetSpaceRect,
          preferredDirection,
        }),
        gap: SPACE_NODE_PADDING,
        obstacles: combinedSpaceObstacles,
      })

      if (aroundSpacePlacement) {
        return { placement: aroundSpacePlacement, canPlace: true }
      }
    }

    return { placement: anchor, canPlace: false }
  }

  const nearbyPlacement = findNearestFreePosition(
    anchor,
    size,
    nodes,
    undefined,
    combinedSpaceObstacles,
  )
  if (isPositionAvailable(nearbyPlacement, size, nodes, undefined, combinedSpaceObstacles)) {
    return { placement: nearbyPlacement, canPlace: true }
  }

  const overflowPlacement = findCanvasOverflowPosition(
    anchor,
    size,
    nodes,
    undefined,
    combinedSpaceObstacles,
  )
  return {
    placement: overflowPlacement ?? anchor,
    canPlace:
      overflowPlacement !== null &&
      isPositionAvailable(overflowPlacement, size, nodes, undefined, combinedSpaceObstacles),
  }
}
