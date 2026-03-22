import type { Node } from '@xyflow/react'
import type { Point, Size, TerminalNodeData, WorkspaceSpaceState } from '../../../types'
import {
  buildOwningSpaceIdByNodeId,
  filterNodesForRegion,
  resolveRegionAtPoint,
} from './workspaceLayoutPolicy'

const GRID_STEP_PX = 40
const MAX_SCAN_RADIUS = 80

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

function rectIntersects(a: Rect, b: Rect): boolean {
  const aRight = a.x + a.width
  const aBottom = a.y + a.height
  const bRight = b.x + b.width
  const bBottom = b.y + b.height

  return !(aRight <= b.x || a.x >= bRight || aBottom <= b.y || a.y >= bBottom)
}

function toRect(anchor: Point, size: Size): Rect {
  return {
    x: anchor.x,
    y: anchor.y,
    width: size.width,
    height: size.height,
  }
}

function toNodeRect(node: Node<TerminalNodeData>): Rect {
  return {
    x: node.position.x,
    y: node.position.y,
    width: node.data.width,
    height: node.data.height,
  }
}

function rectCenter(rect: Rect): { x: number; y: number } {
  return { x: rect.x + rect.width * 0.5, y: rect.y + rect.height * 0.5 }
}

function candidateOffsets(radius: number): Point[] {
  const points: Point[] = []

  for (let y = -radius; y <= radius; y += 1) {
    for (let x = -radius; x <= radius; x += 1) {
      if (Math.max(Math.abs(x), Math.abs(y)) !== radius) {
        continue
      }

      points.push({ x: x * GRID_STEP_PX, y: y * GRID_STEP_PX })
    }
  }

  return points
}

function isRootPlacementAvailable({
  rect,
  nodes,
  spaces,
}: {
  rect: Rect
  nodes: Node<TerminalNodeData>[]
  spaces: WorkspaceSpaceState[]
}): boolean {
  for (const node of nodes) {
    if (rectIntersects(rect, toNodeRect(node))) {
      return false
    }
  }

  for (const space of spaces) {
    if (!space.rect) {
      continue
    }

    if (rectIntersects(rect, space.rect)) {
      return false
    }
  }

  return true
}

function isSpacePlacementAvailable({
  rect,
  nodes,
  space,
}: {
  rect: Rect
  nodes: Node<TerminalNodeData>[]
  space: WorkspaceSpaceState | null
}): boolean {
  if (!space?.rect) {
    return false
  }

  const center = rectCenter(rect)
  const spaceRect = space.rect
  if (
    center.x < spaceRect.x ||
    center.x > spaceRect.x + spaceRect.width ||
    center.y < spaceRect.y ||
    center.y > spaceRect.y + spaceRect.height
  ) {
    return false
  }

  for (const node of nodes) {
    if (rectIntersects(rect, toNodeRect(node))) {
      return false
    }
  }

  return true
}

function findNearestFreePlacement({
  desired,
  isValid,
}: {
  desired: Point
  isValid: (candidate: Point) => boolean
}): Point {
  if (isValid(desired)) {
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

      if (!isValid(candidate)) {
        continue
      }

      const dx = desired.x - candidate.x
      const dy = desired.y - candidate.y
      const distance = Math.hypot(dx, dy)
      if (distance < bestDistance) {
        bestDistance = distance
        bestPosition = candidate
      }
    }

    if (bestPosition) {
      return bestPosition
    }
  }

  return desired
}

export function resolveNodesPlacement({
  anchor,
  size,
  getNodes,
  getSpaces,
  pushBlockingWindowsRight,
}: {
  anchor: Point
  size: Size
  getNodes: () => Node<TerminalNodeData>[]
  getSpaces: () => WorkspaceSpaceState[]
  pushBlockingWindowsRight: (desired: Point, size: Size) => void
}): { placement: Point; canPlace: boolean } {
  const spaces = getSpaces()
  const owningSpaceIdByNodeId = buildOwningSpaceIdByNodeId(spaces)
  const desiredRect = toRect(anchor, size)
  const region = resolveRegionAtPoint(spaces, rectCenter(desiredRect))
  const regionNodes = filterNodesForRegion({ nodes: getNodes(), owningSpaceIdByNodeId, region })

  if (region.kind === 'space') {
    const targetSpace = spaces.find(space => space.id === region.spaceId) ?? null
    if (isSpacePlacementAvailable({ rect: desiredRect, nodes: regionNodes, space: targetSpace })) {
      return { placement: anchor, canPlace: true }
    }

    const fallback = findNearestFreePlacement({
      desired: anchor,
      isValid: candidate =>
        isSpacePlacementAvailable({
          rect: toRect(candidate, size),
          nodes: regionNodes,
          space: targetSpace,
        }),
    })

    const canPlace = isSpacePlacementAvailable({
      rect: toRect(fallback, size),
      nodes: regionNodes,
      space: targetSpace,
    })
    if (canPlace) {
      return { placement: fallback, canPlace: true }
    }

    // When the user creates inside a space but it is currently crowded,
    // allow creation and let post-create space ownership/expansion reflow settle layout.
    return { placement: anchor, canPlace: true }
  }

  if (isRootPlacementAvailable({ rect: desiredRect, nodes: regionNodes, spaces })) {
    return { placement: anchor, canPlace: true }
  }

  pushBlockingWindowsRight(anchor, size)

  const pushedNodes = filterNodesForRegion({ nodes: getNodes(), owningSpaceIdByNodeId, region })
  if (isRootPlacementAvailable({ rect: desiredRect, nodes: pushedNodes, spaces })) {
    return { placement: anchor, canPlace: true }
  }

  const fallback = findNearestFreePlacement({
    desired: anchor,
    isValid: candidate =>
      isRootPlacementAvailable({
        rect: toRect(candidate, size),
        nodes: pushedNodes,
        spaces,
      }),
  })
  return {
    placement: fallback,
    canPlace: isRootPlacementAvailable({
      rect: toRect(fallback, size),
      nodes: pushedNodes,
      spaces,
    }),
  }
}
