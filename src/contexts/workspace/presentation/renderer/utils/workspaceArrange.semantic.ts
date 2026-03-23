import type { Node } from '@xyflow/react'
import type { TerminalNodeData } from '../types'
import type { Rect } from './workspaceArrange.flowPacking'
import { stableRectSort } from './workspaceArrange.flowPacking'
import type { GridItem } from './workspaceArrange.gridPacking'
import type { WorkspaceArrangeOrder } from './workspaceArrange.ordering'
import { resolveNodeCreatedAt, resolveNodeKindRank } from './workspaceArrange.ordering'
import { resolveCanonicalNodeGridSpan } from './workspaceNodeSizing'

type WorkspaceArrangeSemanticGroupKind = 'single' | 'taskAgentPair'

interface WorkspaceArrangeSemanticMember {
  node: Node<TerminalNodeData>
  kind: TerminalNodeData['kind']
}

export interface WorkspaceArrangeSemanticGroup {
  key: string
  kind: WorkspaceArrangeSemanticGroupKind
  rect: Rect
  laneRank: number
  kindRank: number
  createdAt: number | null
  area: number
  members: WorkspaceArrangeSemanticMember[]
}

function toNodeRect(node: Node<TerminalNodeData>): Rect {
  return {
    x: node.position.x,
    y: node.position.y,
    width: node.data.width,
    height: node.data.height,
  }
}

function unionRects(rects: Rect[]): Rect {
  let minX = rects[0]!.x
  let minY = rects[0]!.y
  let maxX = rects[0]!.x + rects[0]!.width
  let maxY = rects[0]!.y + rects[0]!.height

  for (const rect of rects.slice(1)) {
    minX = Math.min(minX, rect.x)
    minY = Math.min(minY, rect.y)
    maxX = Math.max(maxX, rect.x + rect.width)
    maxY = Math.max(maxY, rect.y + rect.height)
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  }
}

function resolveSemanticLaneRank(group: WorkspaceArrangeSemanticGroup): number {
  const leadKind = group.members[0]?.kind ?? 'terminal'

  switch (leadKind) {
    case 'note':
      return 0
    case 'task':
      return 1
    case 'agent':
      return 2
    case 'terminal':
    default:
      return 3
  }
}

function createSingleSemanticGroup(node: Node<TerminalNodeData>): WorkspaceArrangeSemanticGroup {
  const rect = toNodeRect(node)
  const group: WorkspaceArrangeSemanticGroup = {
    key: `semantic:single:${node.id}`,
    kind: 'single',
    rect,
    laneRank: 0,
    kindRank: resolveNodeKindRank(node.data.kind),
    createdAt: resolveNodeCreatedAt(node),
    area: node.data.width * node.data.height,
    members: [{ node, kind: node.data.kind }],
  }

  return {
    ...group,
    laneRank: resolveSemanticLaneRank(group),
  }
}

function createTaskAgentPairSemanticGroup({
  taskNode,
  agentNode,
}: {
  taskNode: Node<TerminalNodeData>
  agentNode: Node<TerminalNodeData>
}): WorkspaceArrangeSemanticGroup {
  const rect = unionRects([toNodeRect(taskNode), toNodeRect(agentNode)])
  const createdAt = resolveNodeCreatedAt(taskNode) ?? resolveNodeCreatedAt(agentNode)
  const group: WorkspaceArrangeSemanticGroup = {
    key: `semantic:task-agent:${taskNode.id}:${agentNode.id}`,
    kind: 'taskAgentPair',
    rect,
    laneRank: 0,
    kindRank: resolveNodeKindRank('task'),
    createdAt,
    area: taskNode.data.width * taskNode.data.height + agentNode.data.width * agentNode.data.height,
    members: [
      { node: taskNode, kind: taskNode.data.kind },
      { node: agentNode, kind: agentNode.data.kind },
    ],
  }

  return {
    ...group,
    laneRank: resolveSemanticLaneRank(group),
  }
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

function compareSemanticGroupsByCreatedAt(
  left: WorkspaceArrangeSemanticGroup,
  right: WorkspaceArrangeSemanticGroup,
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

function compareSemanticGroupsByKind(
  left: WorkspaceArrangeSemanticGroup,
  right: WorkspaceArrangeSemanticGroup,
): number {
  if (left.kindRank !== right.kindRank) {
    return left.kindRank - right.kindRank
  }

  return compareSemanticGroupsByCreatedAt(left, right)
}

function compareSemanticGroupsBySize(
  left: WorkspaceArrangeSemanticGroup,
  right: WorkspaceArrangeSemanticGroup,
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

function compareSemanticGroupsByPosition(
  left: WorkspaceArrangeSemanticGroup,
  right: WorkspaceArrangeSemanticGroup,
): number {
  return stableRectSort({ id: left.key, rect: left.rect }, { id: right.key, rect: right.rect })
}

function compareSemanticGroups(
  left: WorkspaceArrangeSemanticGroup,
  right: WorkspaceArrangeSemanticGroup,
  order: WorkspaceArrangeOrder,
): number {
  if (left.laneRank !== right.laneRank) {
    return left.laneRank - right.laneRank
  }

  if (order === 'createdAt') {
    return compareSemanticGroupsByCreatedAt(left, right)
  }

  if (order === 'kind') {
    return compareSemanticGroupsByKind(left, right)
  }

  if (order === 'size') {
    return compareSemanticGroupsBySize(left, right)
  }

  return compareSemanticGroupsByPosition(left, right)
}

export function createWorkspaceArrangeSemanticGroups({
  nodes,
  order,
}: {
  nodes: Node<TerminalNodeData>[]
  order: WorkspaceArrangeOrder
}): WorkspaceArrangeSemanticGroup[] {
  if (nodes.length <= 1) {
    return nodes.map(createSingleSemanticGroup)
  }

  const nodeById = new Map(nodes.map(node => [node.id, node]))
  const sortedNodes = [...nodes].sort((left, right) =>
    stableRectSort(
      { id: `node:${left.id}`, rect: toNodeRect(left) },
      { id: `node:${right.id}`, rect: toNodeRect(right) },
    ),
  )

  const pairedNodeIds = new Set<string>()
  const groups: WorkspaceArrangeSemanticGroup[] = []

  for (const node of sortedNodes) {
    if (node.data.kind !== 'task' || pairedNodeIds.has(node.id)) {
      continue
    }

    const linkedAgentNodeId = node.data.task?.linkedAgentNodeId ?? null
    if (!linkedAgentNodeId) {
      continue
    }

    const linkedAgentNode = nodeById.get(linkedAgentNodeId)
    if (
      !linkedAgentNode ||
      linkedAgentNode.data.kind !== 'agent' ||
      pairedNodeIds.has(linkedAgentNode.id)
    ) {
      continue
    }

    pairedNodeIds.add(node.id)
    pairedNodeIds.add(linkedAgentNode.id)
    groups.push(
      createTaskAgentPairSemanticGroup({
        taskNode: node,
        agentNode: linkedAgentNode,
      }),
    )
  }

  for (const node of sortedNodes) {
    if (pairedNodeIds.has(node.id)) {
      continue
    }

    groups.push(createSingleSemanticGroup(node))
  }

  return groups.sort((left, right) => compareSemanticGroups(left, right, order))
}

function resolveSemanticGroupSize({
  group,
  gap,
}: {
  group: WorkspaceArrangeSemanticGroup
  gap: number
}): { width: number; height: number } {
  const [firstMember, secondMember] = group.members
  if (!firstMember) {
    return { width: 0, height: 0 }
  }

  if (group.kind !== 'taskAgentPair' || !secondMember) {
    return {
      width: firstMember.node.data.width,
      height: firstMember.node.data.height,
    }
  }

  return {
    width: firstMember.node.data.width + gap + secondMember.node.data.width,
    height: Math.max(firstMember.node.data.height, secondMember.node.data.height),
  }
}

export function createWorkspaceArrangeSemanticFlowItems({
  groups,
  gap,
}: {
  groups: WorkspaceArrangeSemanticGroup[]
  gap: number
}): Array<{ id: string; width: number; height: number }> {
  return groups.map(group => ({
    id: group.key,
    ...resolveSemanticGroupSize({ group, gap }),
  }))
}

export function createWorkspaceArrangeSemanticGridItems(
  groups: WorkspaceArrangeSemanticGroup[],
): GridItem[] {
  return groups.map(group => {
    const [firstMember, secondMember] = group.members
    const firstSpan = resolveCanonicalNodeGridSpan(firstMember?.kind ?? 'terminal')

    if (group.kind !== 'taskAgentPair' || !secondMember) {
      return {
        id: group.key,
        colSpan: firstSpan.colSpan,
        rowSpan: firstSpan.rowSpan,
      }
    }

    const secondSpan = resolveCanonicalNodeGridSpan(secondMember.kind)
    return {
      id: group.key,
      colSpan: firstSpan.colSpan + secondSpan.colSpan,
      rowSpan: Math.max(firstSpan.rowSpan, secondSpan.rowSpan),
    }
  })
}

export function resolveWorkspaceArrangeSemanticNodePlacements({
  groups,
  groupPlacements,
  gap,
}: {
  groups: WorkspaceArrangeSemanticGroup[]
  groupPlacements: Map<string, { x: number; y: number }>
  gap: number
}): Map<string, { x: number; y: number }> {
  const placements = new Map<string, { x: number; y: number }>()

  for (const group of groups) {
    const groupPlacement = groupPlacements.get(group.key)
    if (!groupPlacement) {
      continue
    }

    const [firstMember, secondMember] = group.members
    if (!firstMember) {
      continue
    }

    placements.set(firstMember.node.id, {
      x: groupPlacement.x,
      y: groupPlacement.y,
    })

    if (group.kind !== 'taskAgentPair' || !secondMember) {
      continue
    }

    placements.set(secondMember.node.id, {
      x: groupPlacement.x + firstMember.node.data.width + gap,
      y: groupPlacement.y,
    })
  }

  return placements
}
