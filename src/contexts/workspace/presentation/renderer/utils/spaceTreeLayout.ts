import type { WorkspaceSpaceState } from '../types'

export function buildSpaceById(spaces: WorkspaceSpaceState[]): Map<string, WorkspaceSpaceState> {
  return new Map(spaces.map(space => [space.id, space]))
}

export function buildDirectChildSpaceIdsByParentId(
  spaces: WorkspaceSpaceState[],
): Map<string, string[]> {
  const childIdsByParentId = new Map<string, string[]>()

  for (const space of spaces) {
    const parentSpaceId = space.parentSpaceId ?? null
    if (!parentSpaceId) {
      continue
    }

    const childIds = childIdsByParentId.get(parentSpaceId)
    if (childIds) {
      childIds.push(space.id)
      continue
    }

    childIdsByParentId.set(parentSpaceId, [space.id])
  }

  return childIdsByParentId
}

export function buildOwningSpaceIdByNodeId(spaces: WorkspaceSpaceState[]): Map<string, string> {
  const owningSpaceIdByNodeId = new Map<string, string>()

  for (const space of spaces) {
    for (const nodeId of space.nodeIds) {
      owningSpaceIdByNodeId.set(nodeId, space.id)
    }
  }

  return owningSpaceIdByNodeId
}

export function resolveSpaceRootId(
  spaceId: string,
  spaceById: Map<string, WorkspaceSpaceState>,
): string {
  let currentId = spaceId
  const visited = new Set<string>()

  while (!visited.has(currentId)) {
    visited.add(currentId)

    const parentSpaceId = spaceById.get(currentId)?.parentSpaceId ?? null
    if (!parentSpaceId || !spaceById.has(parentSpaceId)) {
      return currentId
    }

    currentId = parentSpaceId
  }

  return spaceId
}

export function resolveAncestorSpaceIds(
  spaceId: string,
  spaceById: Map<string, WorkspaceSpaceState>,
): string[] {
  const spaceIds: string[] = []
  let currentId: string | null = spaceId
  const visited = new Set<string>()

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId)

    const space = spaceById.get(currentId)
    if (!space) {
      break
    }

    spaceIds.push(currentId)
    currentId = space.parentSpaceId ?? null
  }

  return spaceIds
}

export function buildSpaceTreeGroupIdResolver(
  spaces: WorkspaceSpaceState[],
): (spaceId: string) => string {
  const spaceById = buildSpaceById(spaces)
  const groupIdBySpaceId = new Map<string, string>()

  return (spaceId: string): string => {
    const existing = groupIdBySpaceId.get(spaceId)
    if (existing) {
      return existing
    }

    const groupId = `space:${resolveSpaceRootId(spaceId, spaceById)}`
    groupIdBySpaceId.set(spaceId, groupId)
    return groupId
  }
}
