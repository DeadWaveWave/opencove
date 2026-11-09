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
  /** Set when the agent waits because it ended a turn you have not answered: since when. */
  needsYouSinceMs?: number
  blockedReason?: import('@shared/contracts/dto/agentRunState').AgentRunSnapshot['blockedReason']
}

export interface AgentActivitySummary {
  /** Agents waiting for you, across every project, in project order. */
  waiting: AgentActivityReference[]
  /** Agents at work, across every project, in project order. */
  working: AgentActivityReference[]
}

/**
 * Derived from the same agent model as the sidebar, so the header and rail always agree. An
 * agent waits for you when it is blocked on you, or when it ended a turn that you have not
 * answered yet (`needsYou`, keyed by `agentAttentionKey`, valued by when it started waiting).
 */
export function summarizeAgentActivity(
  workspaces: readonly WorkspaceState[],
  needsYou?: ReadonlyMap<string, number>,
): AgentActivitySummary {
  const waiting: AgentActivityReference[] = []
  const working: AgentActivityReference[] = []
  for (const workspace of workspaces) {
    for (const item of buildSidebarAgentItems(workspace, needsYou)) {
      if (item.status === 'standby') {
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
        ...(item.blockedReason ? { blockedReason: item.blockedReason } : {}),
        ...(item.needsYouSinceMs === undefined ? {} : { needsYouSinceMs: item.needsYouSinceMs }),
      }
      ;(item.status === 'working' ? working : waiting).push(reference)
    }
  }
  return { waiting, working }
}
