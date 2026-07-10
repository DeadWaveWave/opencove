import { closestCenter, pointerWithin, type CollisionDetection } from '@dnd-kit/core'

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

export const sidebarSortableTransition = {
  duration: 180,
  easing: 'cubic-bezier(0.2, 0, 0, 1)',
}

export const sidebarDropAnimation = {
  duration: 180,
  easing: 'cubic-bezier(0.2, 0, 0, 1)',
}

export function canReorderSidebarDragItems(
  activeData: SidebarDragItemData,
  overData: SidebarDragItemData,
): boolean {
  if (activeData.kind !== overData.kind) {
    return false
  }

  if (activeData.kind === 'project' && overData.kind === 'project') {
    return true
  }

  if (activeData.kind === 'space' && overData.kind === 'space') {
    return activeData.workspaceId === overData.workspaceId
  }

  return (
    activeData.kind === 'agent' &&
    overData.kind === 'agent' &&
    activeData.workspaceId === overData.workspaceId &&
    activeData.groupId === overData.groupId
  )
}

export const sidebarCollisionDetection: CollisionDetection = args => {
  const activeData = readSidebarDragItemData(args.active.data.current)
  if (!activeData) {
    return closestCenter(args)
  }

  const droppableContainers = args.droppableContainers.filter(container => {
    const overData = readSidebarDragItemData(container.data.current)
    return overData ? canReorderSidebarDragItems(activeData, overData) : false
  })

  if (droppableContainers.length === 0) {
    return []
  }

  const scopedArgs = {
    ...args,
    droppableContainers,
  }

  const pointerCollisions = pointerWithin(scopedArgs)
  if (pointerCollisions.length > 0 || args.pointerCoordinates) {
    return pointerCollisions
  }

  return closestCenter(scopedArgs)
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
