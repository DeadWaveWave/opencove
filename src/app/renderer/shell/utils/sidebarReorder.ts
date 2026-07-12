import { arrayMove } from '@dnd-kit/sortable'
import type { WorkspaceState } from '@contexts/workspace/presentation/renderer/types'
import { reorderRootSpacesWithinPinGroup } from '@contexts/workspace/domain/workspaceSpacePinning'
import { buildSidebarProjectTree, SIDEBAR_UNASSIGNED_SPACE_GROUP_ID } from './sidebarTree'

export function reorderWorkspaceList(
  workspaces: WorkspaceState[],
  activeWorkspaceId: string,
  overWorkspaceId: string,
): WorkspaceState[] {
  const oldIndex = workspaces.findIndex(workspace => workspace.id === activeWorkspaceId)
  const newIndex = workspaces.findIndex(workspace => workspace.id === overWorkspaceId)

  if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) {
    return workspaces
  }

  return arrayMove(workspaces, oldIndex, newIndex)
}

export function reorderWorkspaceRootSpaces(
  workspaces: WorkspaceState[],
  workspaceId: string,
  activeSpaceId: string,
  overSpaceId: string,
): WorkspaceState[] {
  const workspace = workspaces.find(candidate => candidate.id === workspaceId) ?? null
  if (!workspace || activeSpaceId === overSpaceId) {
    return workspaces
  }

  const nextSpaces = reorderRootSpacesWithinPinGroup(workspace.spaces, activeSpaceId, overSpaceId)
  if (nextSpaces === workspace.spaces) {
    return workspaces
  }

  return workspaces.map(candidate =>
    candidate.id === workspaceId ? { ...candidate, spaces: nextSpaces } : candidate,
  )
}

function findSidebarAgentGroup(
  workspace: WorkspaceState,
  nodeId: string,
): { groupId: string; nodeIds: string[] } | null {
  const tree = buildSidebarProjectTree(workspace)
  const groups = tree.projectRootGroup
    ? [...tree.spaceGroups, tree.projectRootGroup]
    : tree.spaceGroups

  for (const group of groups) {
    const nodeIds = group.agents.map(agent => agent.node.id)
    if (nodeIds.includes(nodeId)) {
      return {
        groupId: group.kind === 'project-root' ? SIDEBAR_UNASSIGNED_SPACE_GROUP_ID : group.id,
        nodeIds,
      }
    }
  }

  return null
}

export function reorderWorkspaceSidebarAgents(
  workspaces: WorkspaceState[],
  workspaceId: string,
  activeNodeId: string,
  overNodeId: string,
): WorkspaceState[] {
  const workspace = workspaces.find(candidate => candidate.id === workspaceId) ?? null
  if (!workspace || activeNodeId === overNodeId) {
    return workspaces
  }

  const activeGroup = findSidebarAgentGroup(workspace, activeNodeId)
  const overGroup = findSidebarAgentGroup(workspace, overNodeId)
  if (!activeGroup || !overGroup || activeGroup.groupId !== overGroup.groupId) {
    return workspaces
  }

  const oldIndex = activeGroup.nodeIds.indexOf(activeNodeId)
  const newIndex = activeGroup.nodeIds.indexOf(overNodeId)
  if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) {
    return workspaces
  }

  const nextNodeIds = arrayMove(activeGroup.nodeIds, oldIndex, newIndex)
  const sortOrderByNodeId = new Map(nextNodeIds.map((id, index) => [id, index] as const))

  let changed = false
  const nodes = workspace.nodes.map(node => {
    const nextSortOrder = sortOrderByNodeId.get(node.id)
    if (
      nextSortOrder === undefined ||
      node.data.kind !== 'agent' ||
      node.data.sidebarSortOrder === nextSortOrder
    ) {
      return node
    }

    changed = true
    return {
      ...node,
      data: {
        ...node.data,
        sidebarSortOrder: nextSortOrder,
      },
    }
  })

  if (!changed) {
    return workspaces
  }

  return workspaces.map(candidate =>
    candidate.id === workspaceId ? { ...candidate, nodes } : candidate,
  )
}
