import type { Node } from '@xyflow/react'
import type { Point, Size, TerminalNodeData } from '../types'

const GRID_STEP = 40
const MAX_SCAN_RADIUS = 80

interface Rect {
  left: number
  top: number
  right: number
  bottom: number
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

export function findNearestFreePosition(
  desired: Point,
  size: Size,
  allNodes: Node<TerminalNodeData>[],
  ignoreNodeId?: string,
): Point {
  if (isPositionAvailable(desired, size, allNodes, ignoreNodeId)) {
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

      if (!isPositionAvailable(candidate, size, allNodes, ignoreNodeId)) {
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

export function findNearestFreePositionOnRight(
  desired: Point,
  size: Size,
  allNodes: Node<TerminalNodeData>[],
  ignoreNodeId?: string,
): Point | null {
  if (isPositionAvailable(desired, size, allNodes, ignoreNodeId)) {
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
        if (isPositionAvailable(candidate, size, allNodes, ignoreNodeId)) {
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
