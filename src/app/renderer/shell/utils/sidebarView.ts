import {
  sidebarVisibilityKey,
  type SidebarViewSettings,
} from '@contexts/settings/domain/sidebarViewSettings'
import { resolveAgentTreatedProvider } from '@contexts/workspace/presentation/renderer/utils/terminalAgentOverlay'
import type { SidebarAgentItemModel } from './sidebarAgents'
import type { SidebarProjectTreeModel, SidebarSpaceGroupModel } from './sidebarTree'

export function projectSidebarView(
  tree: SidebarProjectTreeModel,
  view: SidebarViewSettings,
): { tree: SidebarProjectTreeModel; hiddenWaitingCount: number; matchingAgentCount: number } {
  const workspaceId = tree.workspace.id
  const { filters } = view
  let hiddenWaitingCount = 0
  let matchingAgentCount = 0
  const hasAgentFilter = filters.status !== 'all' || filters.provider !== 'all'
  const projectGroup = (group: SidebarSpaceGroupModel): SidebarSpaceGroupModel | null => {
    const hidden = view.hiddenSpaceIds[sidebarVisibilityKey(workspaceId, group.id)] === true
    const agents = group.agents.flatMap<SidebarAgentItemModel>(agent => {
      const isHidden =
        hidden || view.hiddenAgentIds[sidebarVisibilityKey(workspaceId, agent.node.id)] === true
      if (isHidden && agent.status === 'waiting') {
        hiddenWaitingCount += 1
      }
      if (
        (filters.visibility === 'visible' && isHidden) ||
        (filters.visibility === 'hidden' && !isHidden) ||
        (filters.status !== 'all' && filters.status !== agent.status) ||
        (filters.provider !== 'all' && filters.provider !== resolveAgentTreatedProvider(agent.node))
      ) {
        return []
      }
      matchingAgentCount += 1
      return [{ ...agent, sidebarHidden: isHidden, sidebarHiddenBySpace: hidden }]
    })
    if (group.kind !== 'project-root') {
      if (filters.visibility === 'visible' && hidden) {
        return null
      }
      if (hasAgentFilter && agents.length === 0) {
        return null
      }
      if (filters.visibility === 'hidden' && !hidden && agents.length === 0) {
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
