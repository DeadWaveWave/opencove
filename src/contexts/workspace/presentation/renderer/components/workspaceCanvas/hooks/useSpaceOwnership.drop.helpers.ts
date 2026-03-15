import type { Node } from '@xyflow/react'
import type { TerminalNodeData, WorkspaceSpaceState } from '../../../types'
import { sanitizeSpaces } from '../helpers'
import { isPointInsideRect } from './useSpaceOwnership.helpers'

export function resolveSpaceAtPoint(
  spaces: WorkspaceSpaceState[],
  point: { x: number; y: number },
): WorkspaceSpaceState | null {
  for (const space of spaces) {
    if (!space.rect) {
      continue
    }

    if (isPointInsideRect(point, space.rect)) {
      return space
    }
  }

  return null
}

export function buildDraggedNodesForTarget({
  nodeIds,
  draggedNodePositionById,
  getNode,
}: {
  nodeIds: string[]
  draggedNodePositionById: Map<string, { x: number; y: number }>
  getNode: (nodeId: string) => Node<TerminalNodeData> | undefined
}): Array<Node<TerminalNodeData>> {
  return nodeIds
    .map(nodeId => {
      const node = getNode(nodeId)
      if (!node) {
        return null
      }

      const draggedPosition = draggedNodePositionById.get(nodeId)
      if (!draggedPosition) {
        return node
      }

      if (node.position.x === draggedPosition.x && node.position.y === draggedPosition.y) {
        return node
      }

      return {
        ...node,
        position: draggedPosition,
      }
    })
    .filter((node): node is Node<TerminalNodeData> => Boolean(node))
}

function hasSameNodeIds(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false
  }

  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) {
      return false
    }
  }

  return true
}

export function reassignNodesAcrossSpaces({
  spaces,
  nodeIds,
  targetSpaceId,
}: {
  spaces: WorkspaceSpaceState[]
  nodeIds: string[]
  targetSpaceId: string | null
}): {
  nextSpaces: WorkspaceSpaceState[]
  hasSpaceChange: boolean
} {
  const nodeIdSet = new Set(nodeIds)
  const nextSpaces = sanitizeSpaces(
    spaces.map(space => {
      const filtered = space.nodeIds.filter(nodeId => !nodeIdSet.has(nodeId))
      if (!targetSpaceId || space.id !== targetSpaceId) {
        return { ...space, nodeIds: filtered }
      }

      const incomingNodeIds = nodeIds.filter(nodeId => !space.nodeIds.includes(nodeId))
      if (incomingNodeIds.length === 0) {
        return space
      }

      return { ...space, nodeIds: [...space.nodeIds, ...incomingNodeIds] }
    }),
  )

  const hasSpaceChange =
    nextSpaces.length !== spaces.length ||
    nextSpaces.some((space, index) => {
      const previous = spaces[index]
      if (!previous) {
        return true
      }

      return space.id !== previous.id || !hasSameNodeIds(space.nodeIds, previous.nodeIds)
    })

  return { nextSpaces, hasSpaceChange }
}

export function collectDraggedNodePositions({
  draggedNodeIds,
  fallbackNodes,
  getNode,
}: {
  draggedNodeIds: string[]
  fallbackNodes: Array<Node<TerminalNodeData>>
  getNode: (nodeId: string) => Node<TerminalNodeData> | undefined
}): Map<string, { x: number; y: number }> {
  const draggedNodePositionById = new Map<string, { x: number; y: number }>()

  for (const nodeId of draggedNodeIds) {
    const fromReactFlow = getNode(nodeId)
    if (fromReactFlow) {
      draggedNodePositionById.set(nodeId, {
        x: fromReactFlow.position.x,
        y: fromReactFlow.position.y,
      })
      continue
    }

    const fromEvent = fallbackNodes.find(item => item.id === nodeId)
    if (fromEvent) {
      draggedNodePositionById.set(nodeId, {
        x: fromEvent.position.x,
        y: fromEvent.position.y,
      })
    }
  }

  return draggedNodePositionById
}
