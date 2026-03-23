import type { Node } from '@xyflow/react'
import type { Point, Size, TerminalNodeData } from '../../../types'
import {
  findCanvasOverflowPosition,
  findNearestFreePosition,
  findNearestFreePositionAroundBounds,
  findNearestFreePositionWithinBounds,
  inflateRect,
  isPositionAvailable,
  type Rect,
} from '../../../utils/collision'
import { SPACE_NODE_PADDING } from '../../../utils/spaceLayout'
import type { NodePlacementDirection } from '../types'

function toRectBounds(rect: { x: number; y: number; width: number; height: number }): Rect {
  return {
    left: rect.x,
    top: rect.y,
    right: rect.x + rect.width,
    bottom: rect.y + rect.height,
  }
}

function resolvePreferredDirections({
  anchor,
  size,
  targetSpaceRect,
  preferredDirection,
}: {
  anchor: Point
  size: Size
  targetSpaceRect: { x: number; y: number; width: number; height: number }
  preferredDirection?: NodePlacementDirection
}): Array<'right' | 'down' | 'left' | 'up'> {
  const allDirections: Array<'right' | 'down' | 'left' | 'up'> = ['right', 'down', 'left', 'up']

  if (preferredDirection) {
    return [
      preferredDirection,
      ...allDirections.filter(direction => direction !== preferredDirection),
    ]
  }

  const rightDistance = Math.abs(
    targetSpaceRect.x + targetSpaceRect.width - (anchor.x + size.width),
  )
  const downDistance = Math.abs(
    targetSpaceRect.y + targetSpaceRect.height - (anchor.y + size.height),
  )
  const leftDistance = Math.abs(anchor.x - targetSpaceRect.x)
  const upDistance = Math.abs(anchor.y - targetSpaceRect.y)

  return allDirections.sort((a, b) => {
    const scoreByDirection = {
      right: rightDistance,
      down: downDistance,
      left: leftDistance,
      up: upDistance,
    }

    return scoreByDirection[a] - scoreByDirection[b]
  })
}

export function resolveNodesPlacement({
  anchor,
  size,
  getNodes,
  getSpaceRects,
  targetSpaceRect,
  preferredDirection,
}: {
  anchor: Point
  size: Size
  getNodes: () => Node<TerminalNodeData>[]
  getSpaceRects?: () => Array<{ x: number; y: number; width: number; height: number }>
  targetSpaceRect?: { x: number; y: number; width: number; height: number } | null
  preferredDirection?: NodePlacementDirection
}): { placement: Point; canPlace: boolean } {
  const currentNodes = getNodes()
  const spaceObstacles = (getSpaceRects?.() ?? []).map(rect =>
    inflateRect(toRectBounds(rect), SPACE_NODE_PADDING),
  )
  const targetObstacle = targetSpaceRect
    ? inflateRect(toRectBounds(targetSpaceRect), SPACE_NODE_PADDING)
    : null
  const obstacleEquals = (a: Rect, b: Rect): boolean =>
    a.left === b.left && a.top === b.top && a.right === b.right && a.bottom === b.bottom
  const obstaclesExceptTarget = targetObstacle
    ? spaceObstacles.filter(obstacle => !obstacleEquals(obstacle, targetObstacle))
    : spaceObstacles

  if (!targetSpaceRect) {
    if (isPositionAvailable(anchor, size, currentNodes, undefined, spaceObstacles)) {
      return { placement: anchor, canPlace: true }
    }
  }

  if (targetSpaceRect) {
    const boundedPlacement = findNearestFreePositionWithinBounds(
      anchor,
      size,
      {
        left: targetSpaceRect.x + SPACE_NODE_PADDING,
        top: targetSpaceRect.y + SPACE_NODE_PADDING,
        right: targetSpaceRect.x + targetSpaceRect.width - SPACE_NODE_PADDING,
        bottom: targetSpaceRect.y + targetSpaceRect.height - SPACE_NODE_PADDING,
      },
      currentNodes,
      undefined,
      obstaclesExceptTarget,
    )

    if (boundedPlacement) {
      return { placement: boundedPlacement, canPlace: true }
    }

    const aroundSpacePlacement = findNearestFreePositionAroundBounds({
      desired: anchor,
      size,
      bounds: toRectBounds(targetSpaceRect),
      allNodes: currentNodes,
      directions: resolvePreferredDirections({
        anchor,
        size,
        targetSpaceRect,
        preferredDirection,
      }),
      gap: SPACE_NODE_PADDING,
      obstacles: spaceObstacles,
    })

    if (aroundSpacePlacement) {
      return { placement: aroundSpacePlacement, canPlace: true }
    }
  }

  const nearbyPlacement = findNearestFreePosition(
    anchor,
    size,
    currentNodes,
    undefined,
    spaceObstacles,
  )
  if (isPositionAvailable(nearbyPlacement, size, currentNodes, undefined, spaceObstacles)) {
    return { placement: nearbyPlacement, canPlace: true }
  }

  const overflowPlacement = findCanvasOverflowPosition(
    anchor,
    size,
    currentNodes,
    undefined,
    spaceObstacles,
  )
  return {
    placement: overflowPlacement ?? anchor,
    canPlace:
      overflowPlacement !== null &&
      isPositionAvailable(overflowPlacement, size, currentNodes, undefined, spaceObstacles),
  }
}
