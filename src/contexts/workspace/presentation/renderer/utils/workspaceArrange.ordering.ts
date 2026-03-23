import type { Node } from '@xyflow/react'
import type { TerminalNodeData, WorkspaceSpaceState } from '../types'
import { stableRectSort, type Rect } from './workspaceArrange.flowPacking'

export type WorkspaceArrangeOrder = 'position' | 'createdAt' | 'kind' | 'size'

export type WorkspaceArrangeItemKind = 'space' | 'node'

export interface WorkspaceArrangeItem {
  key: string
  kind: WorkspaceArrangeItemKind
  id: string
  rect: Rect
  createdAt: number | null
  kindRank: number
  area: number
}

function createSpaceArrangeItem({
  space,
  nodeById,
}: {
  space: WorkspaceSpaceState
  nodeById: Map<string, Node<TerminalNodeData>>
}): WorkspaceArrangeItem | null {
  if (!space.rect) {
    return null
  }

  return {
    key: `space:${space.id}`,
    kind: 'space',
    id: space.id,
    rect: { ...space.rect },
    createdAt: resolveSpaceCreatedAt({ space, nodeById }),
    kindRank: 0,
    area: space.rect.width * space.rect.height,
  }
}

function createNodeArrangeItem(node: Node<TerminalNodeData>): WorkspaceArrangeItem {
  return {
    key: `node:${node.id}`,
    kind: 'node',
    id: node.id,
    rect: {
      x: node.position.x,
      y: node.position.y,
      width: node.data.width,
      height: node.data.height,
    },
    createdAt: resolveNodeCreatedAt(node),
    kindRank: resolveNodeKindRank(node.data.kind),
    area: node.data.width * node.data.height,
  }
}

export function resolveNodeCreatedAt(node: Node<TerminalNodeData>): number | null {
  const taskCreatedAt =
    node.data.kind === 'task' && typeof node.data.task?.createdAt === 'string'
      ? node.data.task.createdAt.trim()
      : ''
  if (taskCreatedAt.length > 0) {
    const timestamp = Date.parse(taskCreatedAt)
    if (Number.isFinite(timestamp)) {
      return timestamp
    }
  }

  const startedAt = typeof node.data.startedAt === 'string' ? node.data.startedAt.trim() : ''
  if (startedAt.length > 0) {
    const timestamp = Date.parse(startedAt)
    if (Number.isFinite(timestamp)) {
      return timestamp
    }
  }

  return null
}

export function resolveNodeKindRank(kind: TerminalNodeData['kind']): number {
  switch (kind) {
    case 'task':
      return 1
    case 'note':
      return 2
    case 'agent':
      return 3
    case 'terminal':
    default:
      return 4
  }
}

function resolveSpaceCreatedAt({
  space,
  nodeById,
}: {
  space: WorkspaceSpaceState
  nodeById: Map<string, Node<TerminalNodeData>>
}): number | null {
  let best: number | null = null
  for (const nodeId of space.nodeIds) {
    const node = nodeById.get(nodeId)
    if (!node) {
      continue
    }

    const createdAt = resolveNodeCreatedAt(node)
    if (createdAt === null) {
      continue
    }

    if (best === null || createdAt < best) {
      best = createdAt
    }
  }

  return best
}

function compareNullLast(left: number | null, right: number | null): number {
  if (left === null && right === null) {
    return 0
  }

  if (left === null) {
    return 1
  }

  if (right === null) {
    return -1
  }

  return left - right
}

function compareItemKindThenFallback(
  left: WorkspaceArrangeItem,
  right: WorkspaceArrangeItem,
): number {
  if (left.kindRank !== right.kindRank) {
    return left.kindRank - right.kindRank
  }

  const createdDiff = compareNullLast(left.createdAt, right.createdAt)
  if (createdDiff !== 0) {
    return createdDiff
  }

  const rectDiff = stableRectSort(
    { id: left.key, rect: left.rect },
    { id: right.key, rect: right.rect },
  )
  if (rectDiff !== 0) {
    return rectDiff
  }

  return left.key.localeCompare(right.key)
}

function compareItemCreatedThenFallback(
  left: WorkspaceArrangeItem,
  right: WorkspaceArrangeItem,
): number {
  const createdDiff = compareNullLast(left.createdAt, right.createdAt)
  if (createdDiff !== 0) {
    return createdDiff
  }

  const rectDiff = stableRectSort(
    { id: left.key, rect: left.rect },
    { id: right.key, rect: right.rect },
  )
  if (rectDiff !== 0) {
    return rectDiff
  }

  return left.key.localeCompare(right.key)
}

function compareItemSizeThenFallback(
  left: WorkspaceArrangeItem,
  right: WorkspaceArrangeItem,
): number {
  if (left.area !== right.area) {
    return right.area - left.area
  }

  const rectDiff = stableRectSort(
    { id: left.key, rect: left.rect },
    { id: right.key, rect: right.rect },
  )
  if (rectDiff !== 0) {
    return rectDiff
  }

  return left.key.localeCompare(right.key)
}

export function sortWorkspaceArrangeItems(
  items: WorkspaceArrangeItem[],
  order: WorkspaceArrangeOrder,
): WorkspaceArrangeItem[] {
  if (items.length <= 1) {
    return items
  }

  const next = [...items]

  if (order === 'createdAt') {
    next.sort(compareItemCreatedThenFallback)
    return next
  }

  if (order === 'kind') {
    next.sort(compareItemKindThenFallback)
    return next
  }

  if (order === 'size') {
    next.sort(compareItemSizeThenFallback)
    return next
  }

  next.sort((left, right) =>
    stableRectSort({ id: left.key, rect: left.rect }, { id: right.key, rect: right.rect }),
  )
  return next
}

export function createArrangeItemsForSpaceNodes({
  nodes,
  order,
}: {
  nodes: Node<TerminalNodeData>[]
  order: WorkspaceArrangeOrder
}): Array<{ id: string; width: number; height: number }> {
  const items = nodes.map(node => ({
    id: node.id,
    width: node.data.width,
    height: node.data.height,
    rect: {
      x: node.position.x,
      y: node.position.y,
      width: node.data.width,
      height: node.data.height,
    },
    createdAt: resolveNodeCreatedAt(node),
    kindRank: resolveNodeKindRank(node.data.kind),
    area: node.data.width * node.data.height,
  }))

  const arranged = sortWorkspaceArrangeItems(
    items.map(item => ({
      key: `node:${item.id}`,
      kind: 'node',
      id: item.id,
      rect: item.rect,
      createdAt: item.createdAt,
      kindRank: item.kindRank,
      area: item.area,
    })),
    order,
  )

  return arranged.map(item => ({
    id: item.id,
    width: item.rect.width,
    height: item.rect.height,
  }))
}

export function createArrangeItemsForCanvas({
  nodes,
  spaces,
  order,
}: {
  nodes: Node<TerminalNodeData>[]
  spaces: WorkspaceSpaceState[]
  order: WorkspaceArrangeOrder
}): WorkspaceArrangeItem[] {
  return sortWorkspaceArrangeItems(
    [
      ...createArrangeItemsForCanvasSpaces({ nodes, spaces, order }),
      ...createArrangeItemsForCanvasRootNodes({ nodes, spaces, order }),
    ],
    order,
  )
}

export function createArrangeItemsForCanvasSpaces({
  nodes,
  spaces,
  order,
}: {
  nodes: Node<TerminalNodeData>[]
  spaces: WorkspaceSpaceState[]
  order: WorkspaceArrangeOrder
}): WorkspaceArrangeItem[] {
  const nodeById = new Map(nodes.map(node => [node.id, node]))
  return sortWorkspaceArrangeItems(
    spaces
      .map(space =>
        createSpaceArrangeItem({
          space,
          nodeById,
        }),
      )
      .filter((item): item is WorkspaceArrangeItem => Boolean(item)),
    order,
  )
}

export function createArrangeItemsForCanvasRootNodes({
  nodes,
  spaces,
  order,
}: {
  nodes: Node<TerminalNodeData>[]
  spaces: WorkspaceSpaceState[]
  order: WorkspaceArrangeOrder
}): WorkspaceArrangeItem[] {
  const ownedNodeIdSet = new Set(spaces.flatMap(space => space.nodeIds))
  return sortWorkspaceArrangeItems(
    nodes.filter(node => !ownedNodeIdSet.has(node.id)).map(createNodeArrangeItem),
    order,
  )
}
