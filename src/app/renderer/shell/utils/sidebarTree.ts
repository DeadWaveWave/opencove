import type { LabelColor } from '@shared/types/labelColor'
import type {
  WorkspaceSpaceState,
  WorkspaceState,
} from '@contexts/workspace/presentation/renderer/types'
import { buildSidebarAgentItems, type SidebarAgentItemModel } from './sidebarAgents'

export const SIDEBAR_UNASSIGNED_SPACE_GROUP_ID = 'project-root'

export interface SidebarSpaceGroupModel {
  id: string
  kind: 'space' | 'project-root'
  name: string
  labelColor: LabelColor | null
  space: WorkspaceSpaceState | null
  agents: SidebarAgentItemModel[]
}

export interface SidebarProjectTreeModel {
  workspace: WorkspaceState
  spaceGroups: SidebarSpaceGroupModel[]
  projectRootGroup: SidebarSpaceGroupModel | null
  agentCount: number
  workingAgentCount: number
}

function resolveSortableSpaceOrder(
  space: WorkspaceSpaceState,
  indexBySpaceId: Map<string, number>,
) {
  return typeof space.sortOrder === 'number' && Number.isFinite(space.sortOrder)
    ? Math.floor(space.sortOrder)
    : (indexBySpaceId.get(space.id) ?? Number.MAX_SAFE_INTEGER)
}

function sortRootSpaces(spaces: WorkspaceSpaceState[]): WorkspaceSpaceState[] {
  const indexBySpaceId = new Map(spaces.map((space, index) => [space.id, index] as const))

  return [...spaces].sort((left, right) => {
    const leftOrder = resolveSortableSpaceOrder(left, indexBySpaceId)
    const rightOrder = resolveSortableSpaceOrder(right, indexBySpaceId)

    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder
    }

    return (indexBySpaceId.get(left.id) ?? 0) - (indexBySpaceId.get(right.id) ?? 0)
  })
}

function resolveRootSpaceId(
  space: WorkspaceSpaceState,
  spaceById: Map<string, WorkspaceSpaceState>,
): string {
  let current = space
  const visited = new Set<string>([space.id])

  while (current.parentSpaceId) {
    const parent = spaceById.get(current.parentSpaceId) ?? null
    if (!parent || visited.has(parent.id)) {
      return current.id
    }

    current = parent
    visited.add(current.id)
  }

  return current.id
}

export function buildSidebarProjectTree(workspace: WorkspaceState): SidebarProjectTreeModel {
  const spaceById = new Map(workspace.spaces.map(space => [space.id, space] as const))
  const rootSpaces = sortRootSpaces(
    workspace.spaces.filter(space => {
      const parentSpaceId = space.parentSpaceId ?? null
      return !parentSpaceId || !spaceById.has(parentSpaceId)
    }),
  )
  const spaceGroups = rootSpaces.map<SidebarSpaceGroupModel>(space => ({
    id: space.id,
    kind: 'space',
    name: space.name,
    labelColor: space.labelColor,
    space,
    agents: [],
  }))
  const groupBySpaceId = new Map(spaceGroups.map(group => [group.id, group] as const))
  const projectRootAgents: SidebarAgentItemModel[] = []
  const agentItems = buildSidebarAgentItems(workspace)

  for (const agentItem of agentItems) {
    const owningSpace = agentItem.owningSpace
    if (!owningSpace) {
      projectRootAgents.push(agentItem)
      continue
    }

    const rootSpaceId = resolveRootSpaceId(owningSpace, spaceById)
    const group = groupBySpaceId.get(rootSpaceId) ?? null
    if (!group) {
      projectRootAgents.push(agentItem)
      continue
    }

    group.agents.push(agentItem)
  }

  const projectRootGroup =
    projectRootAgents.length > 0
      ? {
          id: SIDEBAR_UNASSIGNED_SPACE_GROUP_ID,
          kind: 'project-root' as const,
          name: 'Project root',
          labelColor: null,
          space: null,
          agents: projectRootAgents,
        }
      : null

  return {
    workspace,
    spaceGroups,
    projectRootGroup,
    agentCount: agentItems.length,
    workingAgentCount: agentItems.filter(agent => agent.status === 'working').length,
  }
}
