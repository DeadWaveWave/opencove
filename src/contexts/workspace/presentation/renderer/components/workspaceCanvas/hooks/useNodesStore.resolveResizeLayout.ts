import type { Node } from '@xyflow/react'
import type {
  NodeFrame,
  TerminalNodeData,
  WorkspaceSpaceRect,
  WorkspaceSpaceState,
} from '../../../types'
import { expandSpaceToFitOwnedNodesAndPushAway } from '../../../utils/spaceAutoResize'
import { pushAwayLayout, type LayoutDirection, type LayoutItem } from '../../../utils/spaceLayout'

function toNodeRect(node: Node<TerminalNodeData>): WorkspaceSpaceRect {
  return {
    x: node.position.x,
    y: node.position.y,
    width: node.data.width,
    height: node.data.height,
  }
}

function applyNodePositions(
  nodes: Node<TerminalNodeData>[],
  nodePositionById: Map<string, { x: number; y: number }>,
): Node<TerminalNodeData>[] {
  if (nodePositionById.size === 0) {
    return nodes
  }

  let hasChanged = false
  const nextNodes = nodes.map(node => {
    const nextPosition = nodePositionById.get(node.id)
    if (!nextPosition) {
      return node
    }

    if (node.position.x === nextPosition.x && node.position.y === nextPosition.y) {
      return node
    }

    hasChanged = true
    return {
      ...node,
      position: nextPosition,
    }
  })

  return hasChanged ? nextNodes : nodes
}

function resolveResizeDirections(
  previousRect: WorkspaceSpaceRect,
  nextRect: WorkspaceSpaceRect,
): LayoutDirection[] {
  const expansions: Array<{ direction: LayoutDirection; amount: number }> = [
    {
      direction: 'x-' as const,
      amount: previousRect.x - nextRect.x,
    },
    {
      direction: 'x+' as const,
      amount: nextRect.x + nextRect.width - (previousRect.x + previousRect.width),
    },
    {
      direction: 'y-' as const,
      amount: previousRect.y - nextRect.y,
    },
    {
      direction: 'y+' as const,
      amount: nextRect.y + nextRect.height - (previousRect.y + previousRect.height),
    },
  ].filter(entry => entry.amount > 0)

  expansions.sort((left, right) => right.amount - left.amount)
  return expansions.map(entry => entry.direction)
}

function pushAwayNodesInSpace({
  nodeId,
  spaceNodeIds,
  nodes,
  directions,
  gap,
}: {
  nodeId: string
  spaceNodeIds: string[]
  nodes: Node<TerminalNodeData>[]
  directions: LayoutDirection[]
  gap: number
}): Node<TerminalNodeData>[] {
  if (directions.length === 0) {
    return nodes
  }

  const nodeById = new Map(nodes.map(node => [node.id, node]))
  const items: LayoutItem[] = spaceNodeIds
    .map(spaceNodeId => nodeById.get(spaceNodeId))
    .filter((node): node is Node<TerminalNodeData> => Boolean(node))
    .map(node => ({
      id: node.id,
      kind: 'node' as const,
      groupId: node.id,
      rect: toNodeRect(node),
    }))

  if (items.length <= 1) {
    return nodes
  }

  const pushed = pushAwayLayout({
    items,
    pinnedGroupIds: [nodeId],
    sourceGroupIds: [nodeId],
    directions,
    gap,
  })

  const nodePositionById = new Map(
    pushed.map(item => [item.id, { x: item.rect.x, y: item.rect.y }]),
  )

  return applyNodePositions(nodes, nodePositionById)
}

function resolveRootResizePushAway({
  nodeId,
  nodes,
  spaces,
  directions,
  gap,
}: {
  nodeId: string
  nodes: Node<TerminalNodeData>[]
  spaces: WorkspaceSpaceState[]
  directions: LayoutDirection[]
  gap: number
}): { nodes: Node<TerminalNodeData>[]; spaces: WorkspaceSpaceState[] } {
  if (directions.length === 0) {
    return { nodes, spaces }
  }

  const owningSpaceIdByNodeId = new Map<string, string>()
  for (const space of spaces) {
    for (const ownedNodeId of space.nodeIds) {
      owningSpaceIdByNodeId.set(ownedNodeId, space.id)
    }
  }

  const items: LayoutItem[] = []

  for (const space of spaces) {
    if (!space.rect) {
      continue
    }

    items.push({
      id: space.id,
      kind: 'space',
      groupId: space.id,
      rect: { ...space.rect },
    })
  }

  for (const node of nodes) {
    const ownerSpaceId = owningSpaceIdByNodeId.get(node.id) ?? null
    items.push({
      id: node.id,
      kind: 'node',
      groupId: ownerSpaceId ?? node.id,
      rect: toNodeRect(node),
    })
  }

  const pushed = pushAwayLayout({
    items,
    pinnedGroupIds: [nodeId],
    sourceGroupIds: [nodeId],
    directions,
    gap,
  })

  const nextSpaceRectById = new Map(
    pushed.filter(item => item.kind === 'space').map(item => [item.id, item.rect]),
  )
  const nextNodePositionById = new Map(
    pushed
      .filter(item => item.kind === 'node')
      .map(item => [item.id, { x: item.rect.x, y: item.rect.y }]),
  )

  let hasSpaceChanged = false
  const mappedSpaces = spaces.map(space => {
    const nextRect = space.rect ? nextSpaceRectById.get(space.id) : null
    if (!nextRect || !space.rect) {
      return space
    }

    if (
      nextRect.x === space.rect.x &&
      nextRect.y === space.rect.y &&
      nextRect.width === space.rect.width &&
      nextRect.height === space.rect.height
    ) {
      return space
    }

    hasSpaceChanged = true
    return { ...space, rect: nextRect }
  })

  const nextSpaces = hasSpaceChanged ? mappedSpaces : spaces
  const nextNodes = applyNodePositions(nodes, nextNodePositionById)

  return { nodes: nextNodes, spaces: nextSpaces }
}

export function resolveWorkspaceLayoutAfterNodeResize({
  nodeId,
  desiredFrame,
  nodes,
  spaces,
  gap,
}: {
  nodeId: string
  desiredFrame: NodeFrame
  nodes: Node<TerminalNodeData>[]
  spaces: WorkspaceSpaceState[]
  gap: number
}): { nodes: Node<TerminalNodeData>[]; spaces: WorkspaceSpaceState[] } | null {
  const target = nodes.find(node => node.id === nodeId)
  if (!target) {
    return null
  }

  if (
    target.position.x === desiredFrame.position.x &&
    target.position.y === desiredFrame.position.y &&
    target.data.width === desiredFrame.size.width &&
    target.data.height === desiredFrame.size.height
  ) {
    return null
  }

  const previousRect = toNodeRect(target)
  const nextRect: WorkspaceSpaceRect = {
    x: desiredFrame.position.x,
    y: desiredFrame.position.y,
    width: desiredFrame.size.width,
    height: desiredFrame.size.height,
  }
  const directions = resolveResizeDirections(previousRect, nextRect)

  const nodesWithResized = nodes.map(node => {
    if (node.id !== nodeId) {
      return node
    }

    return {
      ...node,
      position: desiredFrame.position,
      data: {
        ...node.data,
        width: desiredFrame.size.width,
        height: desiredFrame.size.height,
      },
    }
  })

  const owningSpace = spaces.find(space => space.nodeIds.includes(nodeId)) ?? null
  if (!owningSpace) {
    return resolveRootResizePushAway({
      nodeId,
      nodes: nodesWithResized,
      spaces,
      directions,
      gap,
    })
  }

  if (directions.length === 0) {
    return { nodes: nodesWithResized, spaces }
  }

  const nodesAfterInternalPush = pushAwayNodesInSpace({
    nodeId,
    spaceNodeIds: owningSpace.nodeIds,
    nodes: nodesWithResized,
    directions,
    gap,
  })

  const { spaces: pushedSpaces, nodePositionById } = expandSpaceToFitOwnedNodesAndPushAway({
    targetSpaceId: owningSpace.id,
    spaces,
    nodeRects: nodesAfterInternalPush.map(node => ({ id: node.id, rect: toNodeRect(node) })),
    gap,
  })

  const nodesAfterSpacePush = applyNodePositions(nodesAfterInternalPush, nodePositionById)

  return { nodes: nodesAfterSpacePush, spaces: pushedSpaces }
}
