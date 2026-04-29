import type { Node } from '@xyflow/react'
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

export type SidebarAgentStatus = 'working' | 'standby'

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

  return 'standby'
}

export function getWorkspaceAgents(workspace: WorkspaceState): Array<Node<TerminalNodeData>> {
  return workspace.nodes
    .filter(node => node.data.kind === 'agent')
    .sort((left, right) => {
      const leftTime = left.data.startedAt ? Date.parse(left.data.startedAt) : 0
      const rightTime = right.data.startedAt ? Date.parse(right.data.startedAt) : 0
      return rightTime - leftTime
    })
}

export function buildSidebarAgentItems(workspace: WorkspaceState): SidebarAgentItemModel[] {
  const inheritedLabelColorByNodeId = buildInheritedLabelColorByNodeId(workspace.spaces)
  const spaceByNodeId = buildSpaceByNodeId(workspace.spaces)

  return getWorkspaceAgents(workspace).map(node => {
    const linkedTaskTitle = findLinkedTaskTitleForAgent(
      workspace.nodes,
      node.id,
      node.data.agent?.taskId ?? null,
    )

    return {
      node,
      displayTitle: node.data.agent
        ? resolveAgentDisplayLabel({
            provider: node.data.agent.provider,
            linkedTaskTitle,
            fallbackTitle: node.data.title,
            preferFallbackTitle: node.data.titlePinnedByUser === true,
          })
        : node.data.title,
      effectiveLabelColor: resolveEffectiveLabelColor(node, inheritedLabelColorByNodeId),
      owningSpace: spaceByNodeId.get(node.id) ?? null,
      status: resolveSidebarAgentStatus(node.data.status),
    }
  })
}

function buildInheritedLabelColorByNodeId(spaces: WorkspaceSpaceState[]): Map<string, LabelColor> {
  const map = new Map<string, LabelColor>()

  for (const space of spaces) {
    if (!space.labelColor) {
      continue
    }

    for (const nodeId of space.nodeIds) {
      if (!map.has(nodeId)) {
        map.set(nodeId, space.labelColor)
      }
    }
  }

  return map
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

function resolveEffectiveLabelColor(
  node: Node<TerminalNodeData>,
  inheritedLabelColorByNodeId: Map<string, LabelColor>,
): LabelColor | null {
  const overrideRaw = (node.data.labelColorOverride ?? null) as unknown
  if (overrideRaw === 'none') {
    return null
  }

  if (isLabelColor(overrideRaw)) {
    return overrideRaw
  }

  return inheritedLabelColorByNodeId.get(node.id) ?? null
}
