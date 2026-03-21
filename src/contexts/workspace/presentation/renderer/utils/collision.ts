import type { Node } from '@xyflow/react'
import type { Point, Size, TerminalNodeData } from '../types'

const GRID_STEP = 40
const MAX_SCAN_RADIUS = 80

export interface Rect {
  left: number
  top: number
  right: number
  bottom: number
}

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

function toNodeRect(node: Node<TerminalNodeData>): Rect {
  const width = node.data.width
  const height = node.data.height
  return {
    left: node.position.x,
    top: node.position.y,
    right: node.position.x + width,
    bottom: node.position.y + height,
  }
}

function intersects(a: Rect, b: Rect): boolean {
  return !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom)
}

export function isPositionAvailable(
  position: Point,
  size: Size,
  allNodes: Node<TerminalNodeData>[],
  ignoreNodeId?: string,
  obstacles?: Rect[],
): boolean {
  const target = toRect(position, size)

  for (const node of allNodes) {
    if (node.id === ignoreNodeId) {
      continue
    }

    const existing = toNodeRect(node)
    if (intersects(target, existing)) {
      return false
    }
  }

  if (Array.isArray(obstacles) && obstacles.length > 0) {
    for (const obstacle of obstacles) {
      if (intersects(target, obstacle)) {
        return false
      }
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

function isPositionWithinBounds(position: Point, size: Size, bounds: Rect): boolean {
  return isRectWithinBounds(toRect(position, size), bounds)
}

export function findNearestFreePosition(
  desired: Point,
  size: Size,
  allNodes: Node<TerminalNodeData>[],
  ignoreNodeId?: string,
  obstacles?: Rect[],
): Point {
  if (isPositionAvailable(desired, size, allNodes, ignoreNodeId, obstacles)) {
    return desired
  }

  let bestPosition: Point | null = null
  let bestDistance = Number.POSITIVE_INFINITY

  for (let radius = 1; radius <= MAX_SCAN_RADIUS; radius += 1) {
    const offsets = candidateOffsets(radius)
    for (const offset of offsets) {
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
  allNodes: Node<TerminalNodeData>[],
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
    const offsets = candidateOffsets(radius)
    for (const offset of offsets) {
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

export function findNearestFreePositionOnRight(
  desired: Point,
  size: Size,
  allNodes: Node<TerminalNodeData>[],
  ignoreNodeId?: string,
  obstacles?: Rect[],
): Point | null {
  if (isPositionAvailable(desired, size, allNodes, ignoreNodeId, obstacles)) {
    return desired
  }

  for (let xRadius = 0; xRadius <= MAX_SCAN_RADIUS; xRadius += 1) {
    const x = desired.x + xRadius * GRID_STEP

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
  allNodes: Node<TerminalNodeData>[]
  directions: Array<'right' | 'down' | 'left' | 'up'>
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
  allNodes: Node<TerminalNodeData>[],
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

export function clampSizeToNonOverlapping(
  origin: Point,
  desired: Size,
  min: Size,
  allNodes: Node<TerminalNodeData>[],
  ignoreNodeId?: string,
): Size {
  const next: Size = { ...desired }

  const maxIterations = 200
  let iterations = 0
  while (!isPositionAvailable(origin, next, allNodes, ignoreNodeId) && iterations < maxIterations) {
    iterations += 1
    if (next.width > min.width) {
      next.width -= 10
    }
    if (next.height > min.height) {
      next.height -= 10
    }

    if (next.width <= min.width && next.height <= min.height) {
      return { ...min }
    }
  }

  return {
    width: Math.max(next.width, min.width),
    height: Math.max(next.height, min.height),
  }
}
