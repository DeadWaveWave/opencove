import type { Node } from '@xyflow/react'
import type { TerminalNodeData, WorkspaceSpaceRect, WorkspaceSpaceState } from '../../../types'
import { pushAwayLayout, type LayoutItem } from '../../../utils/spaceLayout'

export type SetNodes = (
  updater: (prevNodes: Node<TerminalNodeData>[]) => Node<TerminalNodeData>[],
  options?: { syncLayout?: boolean },
) => void

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

const GRID_STEP_PX = 40
const MAX_SCAN_RADIUS = 80

export function isPointInsideRect(
  point: { x: number; y: number },
  rect: WorkspaceSpaceRect,
): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  )
}

export function rectIntersects(a: Rect, b: Rect): boolean {
  const aRight = a.x + a.width
  const aBottom = a.y + a.height
  const bRight = b.x + b.width
  const bBottom = b.y + b.height

  return !(aRight <= b.x || a.x >= bRight || aBottom <= b.y || a.y >= bBottom)
}

export function inflateRect(rect: Rect, inset: number): Rect {
  return {
    x: rect.x - inset,
    y: rect.y - inset,
    width: rect.width + inset * 2,
    height: rect.height + inset * 2,
  }
}

export function computeBoundingRect(nodes: Array<Node<TerminalNodeData>>): Rect | null {
  if (nodes.length === 0) {
    return null
  }

  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (const node of nodes) {
    const x = node.position.x
    const y = node.position.y
    const width = node.data.width
    const height = node.data.height

    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x + width)
    maxY = Math.max(maxY, y + height)
  }

  if (
    !Number.isFinite(minX) ||
    !Number.isFinite(minY) ||
    !Number.isFinite(maxX) ||
    !Number.isFinite(maxY)
  ) {
    return null
  }

  return {
    x: minX,
    y: minY,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY),
  }
}

export function resolveDeltaToKeepRectInsideRect(
  rect: Rect,
  container: Rect,
  inset: number,
): { dx: number; dy: number } {
  const innerLeft = container.x + inset
  const innerTop = container.y + inset
  const innerRight = container.x + container.width - inset
  const innerBottom = container.y + container.height - inset

  const maxWidth = Math.max(0, innerRight - innerLeft)
  const maxHeight = Math.max(0, innerBottom - innerTop)

  let dx = 0
  let dy = 0

  if (rect.width > maxWidth) {
    dx = innerLeft - rect.x
  } else if (rect.x < innerLeft) {
    dx = innerLeft - rect.x
  } else if (rect.x + rect.width > innerRight) {
    dx = innerRight - (rect.x + rect.width)
  }

  if (rect.height > maxHeight) {
    dy = innerTop - rect.y
  } else if (rect.y < innerTop) {
    dy = innerTop - rect.y
  } else if (rect.y + rect.height > innerBottom) {
    dy = innerBottom - (rect.y + rect.height)
  }

  return { dx, dy }
}

export function resolveDeltaToKeepRectOutsideRects(
  rect: Rect,
  obstacles: Rect[],
): { dx: number; dy: number } {
  const working: Rect = { ...rect }

  let totalDx = 0
  let totalDy = 0

  const maxIterations = Math.max(12, obstacles.length * 6)
  let iterations = 0

  while (iterations < maxIterations) {
    iterations += 1

    const blocking = obstacles.find(obstacle => rectIntersects(working, obstacle))
    if (!blocking) {
      break
    }

    const left = blocking.x - (working.x + working.width)
    const right = blocking.x + blocking.width - working.x
    const up = blocking.y - (working.y + working.height)
    const down = blocking.y + blocking.height - working.y

    const candidates: Array<{ dx: number; dy: number }> = [
      { dx: left, dy: 0 },
      { dx: right, dy: 0 },
      { dx: 0, dy: up },
      { dx: 0, dy: down },
    ]

    candidates.sort((a, b) => Math.abs(a.dx || a.dy) - Math.abs(b.dx || b.dy))
    const chosen = candidates[0]
    if (!chosen) {
      break
    }

    working.x += chosen.dx
    working.y += chosen.dy
    totalDx += chosen.dx
    totalDy += chosen.dy
  }

  return { dx: totalDx, dy: totalDy }
}

function compareOffsets(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const aMan = Math.abs(a.x) + Math.abs(a.y)
  const bMan = Math.abs(b.x) + Math.abs(b.y)
  if (aMan !== bMan) {
    return aMan - bMan
  }

  const aXSign = a.x > 0 ? 0 : a.x === 0 ? 1 : 2
  const bXSign = b.x > 0 ? 0 : b.x === 0 ? 1 : 2
  if (aXSign !== bXSign) {
    return aXSign - bXSign
  }

  const aYSign = a.y > 0 ? 0 : a.y === 0 ? 1 : 2
  const bYSign = b.y > 0 ? 0 : b.y === 0 ? 1 : 2
  if (aYSign !== bYSign) {
    return aYSign - bYSign
  }

  const aAbsY = Math.abs(a.y)
  const bAbsY = Math.abs(b.y)
  if (aAbsY !== bAbsY) {
    return aAbsY - bAbsY
  }

  return Math.abs(a.x) - Math.abs(b.x)
}

function candidateOffsets(radius: number): Array<{ x: number; y: number }> {
  const points: Array<{ x: number; y: number }> = []

  for (let y = -radius; y <= radius; y += 1) {
    for (let x = -radius; x <= radius; x += 1) {
      if (Math.max(Math.abs(x), Math.abs(y)) !== radius) {
        continue
      }

      points.push({ x: x * GRID_STEP_PX, y: y * GRID_STEP_PX })
    }
  }

  points.sort(compareOffsets)
  return points
}

export function resolveNearestNonOverlappingDropOffset({
  draggedNodes,
  otherNodes,
  baseDx,
  baseDy,
  targetSpaceRect,
  forbiddenSpaceRects,
}: {
  draggedNodes: Array<Node<TerminalNodeData>>
  otherNodes: Array<Node<TerminalNodeData>>
  baseDx: number
  baseDy: number
  targetSpaceRect: WorkspaceSpaceRect | null
  forbiddenSpaceRects: WorkspaceSpaceRect[]
}): { dx: number; dy: number; canPlace: boolean } {
  const otherRects: Rect[] = otherNodes.map(node => ({
    x: node.position.x,
    y: node.position.y,
    width: node.data.width,
    height: node.data.height,
  }))

  const forbiddenRects: Rect[] = forbiddenSpaceRects.map(rect => ({
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
  }))

  const targetRect: Rect | null = targetSpaceRect
    ? {
        x: targetSpaceRect.x,
        y: targetSpaceRect.y,
        width: targetSpaceRect.width,
        height: targetSpaceRect.height,
      }
    : null

  const candidateIsValid = (offset: { x: number; y: number }): boolean => {
    for (const node of draggedNodes) {
      const candidate: Rect = {
        x: node.position.x + baseDx + offset.x,
        y: node.position.y + baseDy + offset.y,
        width: node.data.width,
        height: node.data.height,
      }

      if (targetRect) {
        const right = candidate.x + candidate.width
        const bottom = candidate.y + candidate.height
        const targetRight = targetRect.x + targetRect.width
        const targetBottom = targetRect.y + targetRect.height

        if (
          candidate.x < targetRect.x ||
          candidate.y < targetRect.y ||
          right > targetRight ||
          bottom > targetBottom
        ) {
          return false
        }
      } else {
        for (const forbidden of forbiddenRects) {
          if (rectIntersects(candidate, forbidden)) {
            return false
          }
        }
      }

      for (const other of otherRects) {
        if (rectIntersects(candidate, other)) {
          return false
        }
      }
    }

    return true
  }

  const initial = { x: 0, y: 0 }
  if (candidateIsValid(initial)) {
    return { dx: 0, dy: 0, canPlace: true }
  }

  for (let radius = 1; radius <= MAX_SCAN_RADIUS; radius += 1) {
    const offsets = candidateOffsets(radius)
    for (const offset of offsets) {
      if (!candidateIsValid(offset)) {
        continue
      }

      return { dx: offset.x, dy: offset.y, canPlace: true }
    }
  }

  return { dx: 0, dy: 0, canPlace: false }
}

export function computePushedPositionsToClearPinnedNodes({
  nodes,
  pinnedNodeIds,
}: {
  nodes: Array<Node<TerminalNodeData>>
  pinnedNodeIds: string[]
}): Map<string, { x: number; y: number }> {
  if (nodes.length === 0 || pinnedNodeIds.length === 0) {
    return new Map()
  }

  const items: LayoutItem[] = nodes.map(node => ({
    id: node.id,
    kind: 'node',
    groupId: node.id,
    rect: {
      x: node.position.x,
      y: node.position.y,
      width: node.data.width,
      height: node.data.height,
    },
  }))

  const pushed = pushAwayLayout({
    items,
    pinnedGroupIds: pinnedNodeIds,
    sourceGroupIds: pinnedNodeIds,
    directions: ['x+'],
    gap: 0,
  })

  return new Map(pushed.map(item => [item.id, { x: item.rect.x, y: item.rect.y }]))
}

export function applyDirectoryExpectationForDrop({
  nodeIds,
  targetSpace,
  workspacePath,
  setNodes,
}: {
  nodeIds: string[]
  targetSpace: WorkspaceSpaceState | null
  workspacePath: string
  setNodes: SetNodes
}): void {
  if (nodeIds.length === 0) {
    return
  }

  const nodeIdSet = new Set(nodeIds)
  const targetDirectory =
    targetSpace && targetSpace.directoryPath.trim().length > 0
      ? targetSpace.directoryPath
      : workspacePath

  setNodes(
    prevNodes => {
      let hasChanged = false

      const nextNodes = prevNodes.map(node => {
        if (!nodeIdSet.has(node.id)) {
          return node
        }

        if (node.data.kind === 'agent' && node.data.agent) {
          const nextExpectedDirectory = targetDirectory

          if (node.data.agent.expectedDirectory === nextExpectedDirectory) {
            return node
          }

          hasChanged = true
          return {
            ...node,
            data: {
              ...node.data,
              agent: {
                ...node.data.agent,
                expectedDirectory: nextExpectedDirectory,
              },
            },
          }
        }

        if (node.data.kind === 'terminal') {
          const executionDirectory =
            typeof node.data.executionDirectory === 'string' &&
            node.data.executionDirectory.trim().length > 0
              ? node.data.executionDirectory
              : workspacePath

          const nextExpectedDirectory = targetDirectory

          if (
            node.data.executionDirectory === executionDirectory &&
            node.data.expectedDirectory === nextExpectedDirectory
          ) {
            return node
          }

          hasChanged = true
          return {
            ...node,
            data: {
              ...node.data,
              executionDirectory,
              expectedDirectory: nextExpectedDirectory,
            },
          }
        }

        return node
      })

      return hasChanged ? nextNodes : prevNodes
    },
    { syncLayout: false },
  )
}

export function restoreSelectionAfterDrop({
  selectedNodeIds,
  setNodes,
}: {
  selectedNodeIds: string[]
  setNodes: SetNodes
}): void {
  if (selectedNodeIds.length === 0) {
    return
  }

  const selectedIdSet = new Set(selectedNodeIds)

  window.requestAnimationFrame(() => {
    setNodes(
      prevNodes => {
        let hasChanged = false
        const nextNodes = prevNodes.map(node => {
          const shouldSelect = selectedIdSet.has(node.id)
          if (node.selected === shouldSelect) {
            return node
          }

          hasChanged = true
          return {
            ...node,
            selected: shouldSelect,
          }
        })

        return hasChanged ? nextNodes : prevNodes
      },
      { syncLayout: false },
    )
  })
}
