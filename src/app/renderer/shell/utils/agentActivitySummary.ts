import type { WorkspaceState } from '@contexts/workspace/presentation/renderer/types'
import type { ProjectIconId } from '@shared/types/projectIcon'
import { buildSidebarAgentItems } from './sidebarAgents'

export interface WaitingAgentReference {
  workspaceId: string
  projectName: string
  projectIconId: ProjectIconId | null
  nodeId: string
  title: string
  /** The Space the agent sits in; null on the project canvas. */
  spaceName: string | null
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
        waiting.push({
          workspaceId: workspace.id,
          projectName: workspace.name,
          projectIconId: workspace.iconId ?? null,
          nodeId: item.node.id,
          title: item.displayTitle,
          spaceName: item.owningSpace?.name ?? null,
        })
      } else if (item.status === 'working') {
        workingCount += 1
      }
    }
  }
  return { waiting, workingCount }
}
