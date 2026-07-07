export type SidebarDragItemData =
  | {
      kind: 'project'
      workspaceId: string
    }
  | {
      kind: 'space'
      workspaceId: string
      spaceId: string
    }
  | {
      kind: 'agent'
      workspaceId: string
      groupId: string
      nodeId: string
    }

export function createSpaceSortableId(workspaceId: string, spaceId: string): string {
  return `sidebar-space:${workspaceId}:${spaceId}`
}

export function createAgentSortableId(
  workspaceId: string,
  groupId: string,
  nodeId: string,
): string {
  return `sidebar-agent:${workspaceId}:${groupId}:${nodeId}`
}

export function readSidebarDragItemData(value: unknown): SidebarDragItemData | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const record = value as Record<string, unknown>
  if (record.kind === 'project' && typeof record.workspaceId === 'string') {
    return {
      kind: 'project',
      workspaceId: record.workspaceId,
    }
  }

  if (
    record.kind === 'space' &&
    typeof record.workspaceId === 'string' &&
    typeof record.spaceId === 'string'
  ) {
    return {
      kind: 'space',
      workspaceId: record.workspaceId,
      spaceId: record.spaceId,
    }
  }

  if (
    record.kind === 'agent' &&
    typeof record.workspaceId === 'string' &&
    typeof record.groupId === 'string' &&
    typeof record.nodeId === 'string'
  ) {
    return {
      kind: 'agent',
      workspaceId: record.workspaceId,
      groupId: record.groupId,
      nodeId: record.nodeId,
    }
  }

  return null
}
