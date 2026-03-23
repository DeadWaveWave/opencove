import type { Node } from '@xyflow/react'
import type { Point, TerminalNodeData, WorkspaceSpaceState } from '../../../types'
import type { SpaceDragState } from '../types'
import type { SpaceFrameHandle } from '../../../utils/spaceLayout'

interface CreateSpaceDragStateParams {
  pointerId: number
  spaceId: string
  startFlow: Point
  startClient: Point
  shiftKey: boolean
  targetSpace: WorkspaceSpaceState
  handle: SpaceFrameHandle
  nodes: Node<TerminalNodeData>[]
  selectedNodeIds: string[]
}

export function createSpaceDragState({
  pointerId,
  spaceId,
  startFlow,
  startClient,
  shiftKey,
  targetSpace,
  handle,
  nodes,
  selectedNodeIds,
}: CreateSpaceDragStateParams): SpaceDragState {
  const movableNodes =
    handle.kind !== 'move'
      ? []
      : [...new Set<string>([...targetSpace.nodeIds, ...selectedNodeIds])]
          .map(nodeId => nodes.find(node => node.id === nodeId))
          .filter((node): node is Node<TerminalNodeData> => Boolean(node))

  const ownedBounds =
    handle.kind !== 'resize'
      ? null
      : resolveOwnedBounds({
          nodeIds: targetSpace.nodeIds,
          nodes,
        })

  return {
    pointerId,
    spaceId,
    startFlow,
    startClient,
    shiftKey,
    initialRect: targetSpace.rect!,
    allNodePositions: new Map(
      nodes.map(node => [node.id, { x: node.position.x, y: node.position.y }]),
    ),
    initialNodePositions: new Map(
      movableNodes.map(node => [node.id, { x: node.position.x, y: node.position.y }]),
    ),
    ownedBounds,
    handle,
  }
}

function resolveOwnedBounds({
  nodeIds,
  nodes,
}: {
  nodeIds: string[]
  nodes: Node<TerminalNodeData>[]
}): SpaceDragState['ownedBounds'] {
  const ownedNodes = nodeIds
    .map(nodeId => nodes.find(node => node.id === nodeId))
    .filter((node): node is Node<TerminalNodeData> => Boolean(node))

  if (ownedNodes.length === 0) {
    return null
  }

  let left = Number.POSITIVE_INFINITY
  let top = Number.POSITIVE_INFINITY
  let right = Number.NEGATIVE_INFINITY
  let bottom = Number.NEGATIVE_INFINITY

  for (const node of ownedNodes) {
    left = Math.min(left, node.position.x)
    top = Math.min(top, node.position.y)
    right = Math.max(right, node.position.x + node.data.width)
    bottom = Math.max(bottom, node.position.y + node.data.height)
  }

  if (
    !Number.isFinite(left) ||
    !Number.isFinite(top) ||
    !Number.isFinite(right) ||
    !Number.isFinite(bottom)
  ) {
    return null
  }

  return { left, top, right, bottom }
}
