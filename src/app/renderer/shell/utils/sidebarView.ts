import {
  sidebarVisibilityKey,
  type SidebarViewSettings,
} from '@contexts/settings/domain/sidebarViewSettings'
import type { SidebarAgentItemModel } from './sidebarAgents'
import type { SidebarProjectTreeModel, SidebarSpaceGroupModel } from './sidebarTree'

export function projectSidebarView(
  tree: SidebarProjectTreeModel,
  view: SidebarViewSettings,
): { tree: SidebarProjectTreeModel; hiddenWaitingCount: number; matchingAgentCount: number } {
  const workspaceId = tree.workspace.id
  const mode = view.mode ?? 'normal'
  const includeHidden = mode === 'all'
  const pinnedAgentIds = view.pinnedAgentIds ?? {}
  let hiddenWaitingCount = 0
  let matchingAgentCount = 0
  const projectGroup = (group: SidebarSpaceGroupModel): SidebarSpaceGroupModel | null => {
    const hidden = view.hiddenSpaceIds[sidebarVisibilityKey(workspaceId, group.id)] === true
    const spacePinned = group.space?.pinned === true
    const agents = group.agents.flatMap<SidebarAgentItemModel>(agent => {
      const isHidden =
        hidden || view.hiddenAgentIds[sidebarVisibilityKey(workspaceId, agent.node.id)] === true
      const agentPinned = pinnedAgentIds[sidebarVisibilityKey(workspaceId, agent.node.id)] === true
      if (isHidden && agent.status === 'waiting') {
        hiddenWaitingCount += 1
      }
      if (mode === 'focus' && !spacePinned && !agentPinned) {
        return []
      }
      if (!includeHidden && isHidden) {
        return []
      }
      matchingAgentCount += 1
      return [{ ...agent, sidebarHidden: isHidden, sidebarHiddenBySpace: hidden }]
    })
    if (group.kind !== 'project-root') {
      if (mode === 'focus' && !spacePinned && agents.length === 0) {
        return null
      }
      if (!includeHidden && hidden) {
        return null
      }
    }
    return { ...group, agents, sidebarHidden: hidden }
  }
  const projectRootGroup = projectGroup(tree.projectRootGroup) ?? tree.projectRootGroup
  const spaceGroups = tree.spaceGroups.flatMap(group => {
    const projected = projectGroup(group)
    return projected ? [projected] : []
  })
  return {
    tree: { ...tree, projectRootGroup, spaceGroups },
    hiddenWaitingCount,
    matchingAgentCount,
  }
}
