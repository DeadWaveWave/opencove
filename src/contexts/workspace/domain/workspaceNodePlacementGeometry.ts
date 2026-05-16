const GRID_STEP = 24
const MAX_SCAN_RADIUS = 80

export interface Point {
  x: number
  y: number
}

export interface Size {
  width: number
  height: number
}

export interface Rect {
  left: number
  top: number
  right: number
  bottom: number
}

export interface WorkspacePlacementNode {
  id: string
  position: Point
  data: Size
}

export type NodePlacementDirection = 'right' | 'down' | 'left' | 'up'

export function inflateRect(rect: Rect, padding: number): Rect {
  const safePadding = Number.isFinite(padding) ? padding : 0
  return {
    left: rect.left - safePadding,
    top: rect.top - safePadding,
    right: rect.right + safePadding,
    bottom: rect.bottom + safePadding,
  }
}

function toRect(point: Point, size: Size): Rect {
  return {
    left: point.x,
    top: point.y,
    right: point.x + size.width,
    bottom: point.y + size.height,
  }
}

function toNodeRect(node: WorkspacePlacementNode): Rect {
  return {
    left: node.position.x,
    top: node.position.y,
    right: node.position.x + node.data.width,
    bottom: node.position.y + node.data.height,
  }
}

export function toRectBounds(rect: { x: number; y: number; width: number; height: number }): Rect {
  return {
    left: rect.x,
    top: rect.y,
    right: rect.x + rect.width,
    bottom: rect.y + rect.height,
  }
}

function intersects(a: Rect, b: Rect): boolean {
  return !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom)
}

export function isPositionAvailable(
  position: Point,
  size: Size,
  allNodes: WorkspacePlacementNode[],
  ignoreNodeId?: string,
  obstacles?: Rect[],
): boolean {
  const target = toRect(position, size)

  for (const node of allNodes) {
    if (node.id === ignoreNodeId) {
      continue
    }

    if (intersects(target, toNodeRect(node))) {
      return false
    }
  }

  for (const obstacle of obstacles ?? []) {
    if (intersects(target, obstacle)) {
      return false
    }
  }

  return true
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function candidateOffsets(radius: number): Point[] {
  const points: Point[] = []
  for (let y = -radius; y <= radius; y += 1) {
    for (let x = -radius; x <= radius; x += 1) {
      if (Math.max(Math.abs(x), Math.abs(y)) !== radius) {
        continue
      }

      points.push({ x: x * GRID_STEP, y: y * GRID_STEP })
    }
  }

  return points
}

function isRectWithinBounds(rect: Rect, bounds: Rect): boolean {
  return (
    rect.left >= bounds.left &&
    rect.top >= bounds.top &&
    rect.right <= bounds.right &&
    rect.bottom <= bounds.bottom
  )
}

export function containsRect(container: Rect, child: Rect): boolean {
  return (
    container.left <= child.left &&
    container.top <= child.top &&
    container.right >= child.right &&
    container.bottom >= child.bottom
  )
}

function isPositionWithinBounds(position: Point, size: Size, bounds: Rect): boolean {
  return isRectWithinBounds(toRect(position, size), bounds)
}

export function findNearestFreePosition(
  desired: Point,
  size: Size,
  allNodes: WorkspacePlacementNode[],
  ignoreNodeId?: string,
  obstacles?: Rect[],
): Point {
  if (isPositionAvailable(desired, size, allNodes, ignoreNodeId, obstacles)) {
    return desired
  }

  let bestPosition: Point | null = null
  let bestDistance = Number.POSITIVE_INFINITY

  for (let radius = 1; radius <= MAX_SCAN_RADIUS; radius += 1) {
    for (const offset of candidateOffsets(radius)) {
      const candidate = {
        x: desired.x + offset.x,
        y: desired.y + offset.y,
      }

      if (!isPositionAvailable(candidate, size, allNodes, ignoreNodeId, obstacles)) {
        continue
      }

      const candidateDistance = distance(desired, candidate)
      if (candidateDistance < bestDistance) {
        bestDistance = candidateDistance
        bestPosition = candidate
      }
    }

    if (bestPosition) {
      return bestPosition
    }
  }

  return desired
}

export function findNearestFreePositionWithinBounds(
  desired: Point,
  size: Size,
  bounds: Rect,
  allNodes: WorkspacePlacementNode[],
  ignoreNodeId?: string,
  obstacles?: Rect[],
): Point | null {
  if (
    isPositionWithinBounds(desired, size, bounds) &&
    isPositionAvailable(desired, size, allNodes, ignoreNodeId, obstacles)
  ) {
    return desired
  }

  let bestPosition: Point | null = null
  let bestDistance = Number.POSITIVE_INFINITY

  for (let radius = 1; radius <= MAX_SCAN_RADIUS; radius += 1) {
    for (const offset of candidateOffsets(radius)) {
      const candidate = {
        x: desired.x + offset.x,
        y: desired.y + offset.y,
      }

      if (!isPositionWithinBounds(candidate, size, bounds)) {
        continue
      }

      if (!isPositionAvailable(candidate, size, allNodes, ignoreNodeId, obstacles)) {
        continue
      }

      const candidateDistance = distance(desired, candidate)
      if (candidateDistance < bestDistance) {
        bestDistance = candidateDistance
        bestPosition = candidate
      }
    }

    if (bestPosition) {
      return bestPosition
    }
  }

  return null
}

function isPointWithinBounds(point: Point, bounds: Rect): boolean {
  return (
    point.x >= bounds.left &&
    point.y >= bounds.top &&
    point.x <= bounds.right &&
    point.y <= bounds.bottom
  )
}

function clampPointWithinBounds(point: Point, bounds: Rect): Point {
  return {
    x: Math.min(Math.max(point.x, bounds.left), bounds.right),
    y: Math.min(Math.max(point.y, bounds.top), bounds.bottom),
  }
}

export function findNearestFreeAnchorWithinBounds(
  desired: Point,
  size: Size,
  bounds: Rect,
  allNodes: WorkspacePlacementNode[],
  ignoreNodeId?: string,
  obstacles?: Rect[],
): Point | null {
  if (
    isPointWithinBounds(desired, bounds) &&
    isPositionAvailable(desired, size, allNodes, ignoreNodeId, obstacles)
  ) {
    return desired
  }

  const clampedDesired = clampPointWithinBounds(desired, bounds)
  if (
    (clampedDesired.x !== desired.x || clampedDesired.y !== desired.y) &&
    isPositionAvailable(clampedDesired, size, allNodes, ignoreNodeId, obstacles)
  ) {
    return clampedDesired
  }

  let bestPosition: Point | null = null
  let bestDistance = Number.POSITIVE_INFINITY

  for (let radius = 1; radius <= MAX_SCAN_RADIUS; radius += 1) {
    for (const offset of candidateOffsets(radius)) {
      const candidate = {
        x: desired.x + offset.x,
        y: desired.y + offset.y,
      }

      if (!isPointWithinBounds(candidate, bounds)) {
        continue
      }

      if (!isPositionAvailable(candidate, size, allNodes, ignoreNodeId, obstacles)) {
        continue
      }

      const candidateDistance = distance(desired, candidate)
      if (candidateDistance < bestDistance) {
        bestDistance = candidateDistance
        bestPosition = candidate
      }
    }

    if (bestPosition) {
      return bestPosition
    }
  }

  return null
}

function resolveAxisCandidates(base: number, radius: number): number[] {
  const values = [base]

  for (let offset = 1; offset <= radius; offset += 1) {
    values.push(base + offset * GRID_STEP, base - offset * GRID_STEP)
  }

  return values
}

export function findNearestFreePositionAroundBounds({
  desired,
  size,
  bounds,
  allNodes,
  directions,
  gap = GRID_STEP,
  ignoreNodeId,
  obstacles,
}: {
  desired: Point
  size: Size
  bounds: Rect
  allNodes: WorkspacePlacementNode[]
  directions: NodePlacementDirection[]
  gap?: number
  ignoreNodeId?: string
  obstacles?: Rect[]
}): Point | null {
  for (let layer = 0; layer <= MAX_SCAN_RADIUS; layer += 1) {
    for (const direction of directions) {
      if (direction === 'right') {
        const x = bounds.right + gap + layer * GRID_STEP
        for (const y of resolveAxisCandidates(desired.y, layer)) {
          const candidate = { x, y }
          if (isPositionAvailable(candidate, size, allNodes, ignoreNodeId, obstacles)) {
            return candidate
          }
        }
        continue
      }

      if (direction === 'left') {
        const x = bounds.left - size.width - gap - layer * GRID_STEP
        for (const y of resolveAxisCandidates(desired.y, layer)) {
          const candidate = { x, y }
          if (isPositionAvailable(candidate, size, allNodes, ignoreNodeId, obstacles)) {
            return candidate
          }
        }
        continue
      }

      if (direction === 'down') {
        const y = bounds.bottom + gap + layer * GRID_STEP
        for (const x of resolveAxisCandidates(desired.x, layer)) {
          const candidate = { x, y }
          if (isPositionAvailable(candidate, size, allNodes, ignoreNodeId, obstacles)) {
            return candidate
          }
        }
        continue
      }

      const y = bounds.top - size.height - gap - layer * GRID_STEP
      for (const x of resolveAxisCandidates(desired.x, layer)) {
        const candidate = { x, y }
        if (isPositionAvailable(candidate, size, allNodes, ignoreNodeId, obstacles)) {
          return candidate
        }
      }
    }
  }

  return null
}

export function findCanvasOverflowPosition(
  desired: Point,
  size: Size,
  allNodes: WorkspacePlacementNode[],
  ignoreNodeId?: string,
  obstacles?: Rect[],
): Point | null {
  if (allNodes.length === 0) {
    return desired
  }

  const maxRight = Math.max(...allNodes.map(node => node.position.x + node.data.width))
  const baseX = maxRight + GRID_STEP

  for (let xRadius = 0; xRadius <= MAX_SCAN_RADIUS; xRadius += 1) {
    const x = baseX + xRadius * GRID_STEP

    for (let yRadius = 0; yRadius <= MAX_SCAN_RADIUS; yRadius += 1) {
      const yCandidates =
        yRadius === 0
          ? [desired.y]
          : [desired.y + yRadius * GRID_STEP, desired.y - yRadius * GRID_STEP]

      for (const y of yCandidates) {
        const candidate = { x, y }
        if (isPositionAvailable(candidate, size, allNodes, ignoreNodeId, obstacles)) {
          return candidate
        }
      }
    }
  }

  return null
}

export function resolvePreferredDirections({
  anchor,
  size,
  targetSpaceRect,
  preferredDirection,
}: {
  anchor: Point
  size: Size
  targetSpaceRect: { x: number; y: number; width: number; height: number }
  preferredDirection?: NodePlacementDirection
}): NodePlacementDirection[] {
  const allDirections: NodePlacementDirection[] = ['right', 'down', 'left', 'up']

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
