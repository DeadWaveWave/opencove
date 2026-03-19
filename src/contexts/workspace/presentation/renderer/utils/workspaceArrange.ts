import type { Node } from '@xyflow/react'
import type { TerminalNodeData, WorkspaceSpaceRect, WorkspaceSpaceState } from '../types'
import {
  computeBoundingRect,
  resolveBoundedFlowPacking,
  resolveFlowPacking,
  snapDown,
  stableRectSort,
  type FlowItem,
  type Rect,
} from './workspaceArrange.flowPacking'

export const WORKSPACE_ARRANGE_PADDING_PX = 24
export const WORKSPACE_ARRANGE_GAP_PX = 24
export const WORKSPACE_ARRANGE_GRID_PX = 24

export type WorkspaceArrangeWarning =
  | { kind: 'space_missing_rect'; spaceId: string }
  | { kind: 'space_no_room'; spaceId: string }

export interface WorkspaceArrangeResult {
  nodes: Node<TerminalNodeData>[]
  spaces: WorkspaceSpaceState[]
  warnings: WorkspaceArrangeWarning[]
  didChange: boolean
}

function toNodeRect(node: Node<TerminalNodeData>): Rect {
  return {
    x: node.position.x,
    y: node.position.y,
    width: node.data.width,
    height: node.data.height,
  }
}

function computeOwnedNodeIdSet(spaces: WorkspaceSpaceState[]): Set<string> {
  const owned = new Set<string>()
  for (const space of spaces) {
    for (const nodeId of space.nodeIds) {
      owned.add(nodeId)
    }
  }
  return owned
}

function arrangeNodesWithinSpaceRect({
  spaceRect,
  nodes,
  padding,
  gap,
}: {
  spaceRect: WorkspaceSpaceRect
  nodes: Node<TerminalNodeData>[]
  padding: number
  gap: number
}): Map<string, { x: number; y: number }> | null {
  const innerRect: Rect = {
    x: spaceRect.x + padding,
    y: spaceRect.y + padding,
    width: spaceRect.width - padding * 2,
    height: spaceRect.height - padding * 2,
  }

  const sorted = [...nodes].sort((left, right) =>
    stableRectSort(
      { id: left.id, rect: toNodeRect(left) },
      { id: right.id, rect: toNodeRect(right) },
    ),
  )

  const items: FlowItem[] = sorted.map(node => ({
    id: node.id,
    width: node.data.width,
    height: node.data.height,
  }))

  const placements = resolveBoundedFlowPacking({
    items,
    bounds: innerRect,
    gap,
  })

  return placements
}

export function arrangeWorkspaceInSpace({
  spaceId,
  nodes,
  spaces,
  padding = WORKSPACE_ARRANGE_PADDING_PX,
  gap = WORKSPACE_ARRANGE_GAP_PX,
}: {
  spaceId: string
  nodes: Node<TerminalNodeData>[]
  spaces: WorkspaceSpaceState[]
  padding?: number
  gap?: number
}): WorkspaceArrangeResult {
  const targetSpace = spaces.find(space => space.id === spaceId) ?? null
  if (!targetSpace) {
    return { nodes, spaces, warnings: [], didChange: false }
  }

  if (!targetSpace.rect) {
    return {
      nodes,
      spaces,
      warnings: [{ kind: 'space_missing_rect', spaceId }],
      didChange: false,
    }
  }

  const nodeById = new Map(nodes.map(node => [node.id, node]))
  const ownedNodes = targetSpace.nodeIds
    .map(nodeId => nodeById.get(nodeId))
    .filter((node): node is Node<TerminalNodeData> => Boolean(node))

  if (ownedNodes.length <= 1) {
    return { nodes, spaces, warnings: [], didChange: false }
  }

  const placements =
    arrangeNodesWithinSpaceRect({
      spaceRect: targetSpace.rect,
      nodes: ownedNodes,
      padding,
      gap,
    }) ?? null

  if (!placements) {
    return {
      nodes,
      spaces,
      warnings: [{ kind: 'space_no_room', spaceId }],
      didChange: false,
    }
  }

  let didChange = false
  const nextNodes = nodes.map(node => {
    const placement = placements.get(node.id)
    if (!placement) {
      return node
    }

    if (node.position.x === placement.x && node.position.y === placement.y) {
      return node
    }

    didChange = true
    return {
      ...node,
      position: {
        x: placement.x,
        y: placement.y,
      },
    }
  })

  return didChange
    ? { nodes: nextNodes, spaces, warnings: [], didChange }
    : { nodes, spaces, warnings: [], didChange }
}

export function arrangeWorkspaceCanvas({
  nodes,
  spaces,
  wrapWidth,
  gap = WORKSPACE_ARRANGE_GAP_PX,
  grid = WORKSPACE_ARRANGE_GRID_PX,
}: {
  nodes: Node<TerminalNodeData>[]
  spaces: WorkspaceSpaceState[]
  wrapWidth: number
  gap?: number
  grid?: number
}): WorkspaceArrangeResult {
  const ownedNodeIdSet = computeOwnedNodeIdSet(spaces)
  const rootNodes = nodes.filter(node => !ownedNodeIdSet.has(node.id))
  const visibleSpaces = spaces.filter(space => Boolean(space.rect))

  const items: Array<{ key: string; kind: 'space' | 'node'; id: string; rect: Rect }> = [
    ...visibleSpaces.flatMap(space => {
      if (!space.rect) {
        return []
      }

      return [
        {
          key: `space:${space.id}`,
          kind: 'space' as const,
          id: space.id,
          rect: { ...space.rect },
        },
      ]
    }),
    ...rootNodes.map(node => ({
      key: `node:${node.id}`,
      kind: 'node' as const,
      id: node.id,
      rect: toNodeRect(node),
    })),
  ].sort((left, right) =>
    stableRectSort({ id: left.key, rect: left.rect }, { id: right.key, rect: right.rect }),
  )

  const bounding = computeBoundingRect(items.map(item => item.rect))
  if (!bounding) {
    return { nodes, spaces, warnings: [], didChange: false }
  }

  const start = { x: snapDown(bounding.x, grid), y: snapDown(bounding.y, grid) }
  const placements = resolveFlowPacking({
    items: items.map(item => ({ id: item.key, width: item.rect.width, height: item.rect.height })),
    start,
    wrapWidth: snapDown(wrapWidth, grid),
    gap,
  })

  const spaceDeltaById = new Map<string, { dx: number; dy: number }>()
  for (const item of items) {
    if (item.kind !== 'space') {
      continue
    }

    const placed = placements.get(item.key)
    if (!placed) {
      continue
    }

    const dx = placed.x - item.rect.x
    const dy = placed.y - item.rect.y
    if (dx === 0 && dy === 0) {
      continue
    }

    spaceDeltaById.set(item.id, { dx, dy })
  }

  const nodePlacementById = new Map<string, { x: number; y: number }>()
  for (const item of items) {
    if (item.kind !== 'node') {
      continue
    }

    const placed = placements.get(item.key)
    if (!placed) {
      continue
    }

    nodePlacementById.set(item.id, placed)
  }

  const owningSpaceIdByNodeId = new Map<string, string>()
  for (const space of spaces) {
    for (const nodeId of space.nodeIds) {
      if (!owningSpaceIdByNodeId.has(nodeId)) {
        owningSpaceIdByNodeId.set(nodeId, space.id)
      }
    }
  }

  let didChange = false
  const nextNodes = nodes.map(node => {
    const rootPlacement = nodePlacementById.get(node.id)
    if (rootPlacement) {
      if (node.position.x === rootPlacement.x && node.position.y === rootPlacement.y) {
        return node
      }

      didChange = true
      return {
        ...node,
        position: { x: rootPlacement.x, y: rootPlacement.y },
      }
    }

    const owningSpaceId = owningSpaceIdByNodeId.get(node.id) ?? null
    const delta = owningSpaceId ? (spaceDeltaById.get(owningSpaceId) ?? null) : null
    if (!delta) {
      return node
    }

    const nextPosition = {
      x: node.position.x + delta.dx,
      y: node.position.y + delta.dy,
    }

    if (node.position.x === nextPosition.x && node.position.y === nextPosition.y) {
      return node
    }

    didChange = true
    return {
      ...node,
      position: nextPosition,
    }
  })

  const nextSpaces = spaces.map(space => {
    if (!space.rect) {
      return space
    }

    const delta = spaceDeltaById.get(space.id)
    if (!delta) {
      return space
    }

    didChange = true
    return {
      ...space,
      rect: {
        ...space.rect,
        x: space.rect.x + delta.dx,
        y: space.rect.y + delta.dy,
      },
    }
  })

  return didChange
    ? { nodes: nextNodes, spaces: nextSpaces, warnings: [], didChange }
    : { nodes, spaces, warnings: [], didChange }
}

export function arrangeWorkspaceAll({
  nodes,
  spaces,
  wrapWidth,
  padding = WORKSPACE_ARRANGE_PADDING_PX,
  gap = WORKSPACE_ARRANGE_GAP_PX,
  grid = WORKSPACE_ARRANGE_GRID_PX,
}: {
  nodes: Node<TerminalNodeData>[]
  spaces: WorkspaceSpaceState[]
  wrapWidth: number
  padding?: number
  gap?: number
  grid?: number
}): WorkspaceArrangeResult {
  let nextNodes = nodes
  let didInnerChange = false
  const warnings: WorkspaceArrangeWarning[] = []

  for (const space of spaces) {
    if (!space.rect) {
      continue
    }

    const innerResult = arrangeWorkspaceInSpace({
      spaceId: space.id,
      nodes: nextNodes,
      spaces,
      padding,
      gap,
    })

    if (innerResult.warnings.length > 0) {
      warnings.push(...innerResult.warnings)
      continue
    }

    if (innerResult.didChange) {
      didInnerChange = true
      nextNodes = innerResult.nodes
    }
  }

  const outer = arrangeWorkspaceCanvas({
    nodes: nextNodes,
    spaces,
    wrapWidth,
    gap,
    grid,
  })

  return {
    nodes: outer.nodes,
    spaces: outer.spaces,
    warnings,
    didChange: didInnerChange || outer.didChange,
  }
}
