import type { AgentProvider } from '@contexts/settings/domain/agentSettings'
import type { WorkspaceState } from '@contexts/workspace/presentation/renderer/types'
import { resolveAgentPresentationProvider } from '@contexts/workspace/presentation/renderer/utils/agentPresentation'
import type { ProjectIconId } from '@shared/types/projectIcon'
import { buildSidebarAgentItems } from './sidebarAgents'

export interface AgentActivityReference {
  workspaceId: string
  projectName: string
  projectIconId: ProjectIconId | null
  nodeId: string
  title: string
  /** The Space the agent sits in; null on the project canvas. */
  spaceName: string | null
  /** Whose mark the agent wears; null when it cannot be told. */
  provider: AgentProvider | null
}

export interface AgentActivitySummary {
  /** Agents waiting for you, across every project, in project order. */
  waiting: AgentActivityReference[]
  /** Agents at work, across every project, in project order. */
  working: AgentActivityReference[]
}

/** Derived from the same agent model as the sidebar, so the header and rail always agree. */
export function summarizeAgentActivity(
  workspaces: readonly WorkspaceState[],
): AgentActivitySummary {
  const waiting: AgentActivityReference[] = []
  const working: AgentActivityReference[] = []
  for (const workspace of workspaces) {
    for (const item of buildSidebarAgentItems(workspace)) {
      if (item.status !== 'waiting' && item.status !== 'working') {
        continue
      }
      const reference: AgentActivityReference = {
        workspaceId: workspace.id,
        projectName: workspace.name,
        projectIconId: workspace.iconId ?? null,
        nodeId: item.node.id,
        title: item.displayTitle,
        spaceName: item.owningSpace?.name ?? null,
        provider: resolveAgentPresentationProvider(item.node.data),
      }
      ;(item.status === 'waiting' ? waiting : working).push(reference)
    }
  }
  return { waiting, working }
}
