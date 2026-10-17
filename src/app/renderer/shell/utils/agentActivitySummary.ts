import type { WorkspaceState } from '@contexts/workspace/presentation/renderer/types'
import { buildSidebarAgentItems } from './sidebarAgents'

export interface WaitingAgentReference {
  workspaceId: string
  nodeId: string
  title: string
}

export interface AgentActivitySummary {
  /** Agents waiting for you, across every project, in project order. */
  waiting: WaitingAgentReference[]
  workingCount: number
}

/** Derived from the same agent model as the sidebar, so the header and rail always agree. */
export function summarizeAgentActivity(
  workspaces: readonly WorkspaceState[],
): AgentActivitySummary {
  const waiting: WaitingAgentReference[] = []
  let workingCount = 0
  for (const workspace of workspaces) {
    for (const item of buildSidebarAgentItems(workspace)) {
      if (item.status === 'waiting') {
        waiting.push({ workspaceId: workspace.id, nodeId: item.node.id, title: item.displayTitle })
      } else if (item.status === 'working') {
        workingCount += 1
      }
    }
  }
  return { waiting, workingCount }
}
