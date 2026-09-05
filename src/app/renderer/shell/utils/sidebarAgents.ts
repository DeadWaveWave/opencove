import type { Node } from '@xyflow/react'
import { resolveAgentPresentation } from '@contexts/workspace/presentation/renderer/utils/agentPresentation'
import { isLabelColor, type LabelColor } from '@shared/types/labelColor'
import type {
  TerminalNodeData,
  WorkspaceSpaceState,
  WorkspaceState,
} from '@contexts/workspace/presentation/renderer/types'
import {
  findLinkedTaskTitleForAgent,
  resolveAgentDisplayLabel,
} from '@contexts/workspace/presentation/renderer/utils/agentTitle'
import {
  isAgentTreatedNode,
  resolveAgentTreatedProvider,
} from '@contexts/workspace/presentation/renderer/utils/terminalAgentOverlay'

export type SidebarAgentStatus = 'working' | 'waiting' | 'standby'

export interface SidebarAgentItemModel {
  node: Node<TerminalNodeData>
  displayTitle: string
  effectiveLabelColor: LabelColor | null
  owningSpace: WorkspaceSpaceState | null
  status: SidebarAgentStatus
}

export function resolveSidebarAgentStatus(
  runtimeStatus: TerminalNodeData['status'],
): SidebarAgentStatus {
  if (runtimeStatus === null) {
    return 'working'
  }

  if (runtimeStatus === 'running' || runtimeStatus === 'restoring') {
    return 'working'
  }

  if (runtimeStatus === 'waiting') {
    return 'waiting'
  }

  return 'standby'
}

export function getWorkspaceAgents(workspace: WorkspaceState): Array<Node<TerminalNodeData>> {
  return workspace.nodes.filter(isAgentTreatedNode).sort((left, right) => {
    const leftSortOrder =
      typeof left.data.sidebarSortOrder === 'number' && Number.isFinite(left.data.sidebarSortOrder)
        ? Math.floor(left.data.sidebarSortOrder)
        : null
    const rightSortOrder =
      typeof right.data.sidebarSortOrder === 'number' &&
      Number.isFinite(right.data.sidebarSortOrder)
        ? Math.floor(right.data.sidebarSortOrder)
        : null

    if (leftSortOrder !== null || rightSortOrder !== null) {
      if (leftSortOrder === null) {
        return 1
      }
      if (rightSortOrder === null) {
        return -1
      }
      if (leftSortOrder !== rightSortOrder) {
        return leftSortOrder - rightSortOrder
      }
    }

    const leftTime = left.data.startedAt ? Date.parse(left.data.startedAt) : 0
    const rightTime = right.data.startedAt ? Date.parse(right.data.startedAt) : 0
    return rightTime - leftTime
  })
}

export function buildSidebarAgentItems(workspace: WorkspaceState): SidebarAgentItemModel[] {
  const spaceByNodeId = buildSpaceByNodeId(workspace.spaces)

  return getWorkspaceAgents(workspace).map(node => {
    const linkedTaskTitle = findLinkedTaskTitleForAgent(
      workspace.nodes,
      node.id,
      node.data.agent?.taskId ?? null,
    )
    const provider = resolveAgentTreatedProvider(node)

    return {
      node,
      displayTitle:
        node.data.kind === 'agent' && node.data.agent
          ? resolveAgentDisplayLabel({
              provider: node.data.agent.provider,
              linkedTaskTitle,
              fallbackTitle: node.data.title,
              preferFallbackTitle: node.data.titlePinnedByUser === true,
            })
          : provider
            ? resolveAgentDisplayLabel({
                provider,
                linkedTaskTitle: null,
                fallbackTitle: node.data.title,
                preferFallbackTitle: node.data.titlePinnedByUser === true,
              })
            : node.data.title,
      effectiveLabelColor: resolveEffectiveLabelColor(node),
      owningSpace: spaceByNodeId.get(node.id) ?? null,
      status: resolveSidebarAgentStatus(resolveAgentPresentation(node.data).status),
    }
  })
}

function buildSpaceByNodeId(spaces: WorkspaceSpaceState[]): Map<string, WorkspaceSpaceState> {
  const map = new Map<string, WorkspaceSpaceState>()

  for (const space of spaces) {
    for (const nodeId of space.nodeIds) {
      if (!map.has(nodeId)) {
        map.set(nodeId, space)
      }
    }
  }

  return map
}

function resolveEffectiveLabelColor(node: Node<TerminalNodeData>): LabelColor | null {
  const overrideRaw = (node.data.labelColorOverride ?? null) as unknown
  if (overrideRaw === 'none') {
    return null
  }

  if (isLabelColor(overrideRaw)) {
    return overrideRaw
  }

  return null
}
