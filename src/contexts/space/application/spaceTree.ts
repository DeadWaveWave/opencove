export interface SpaceTreeRecord {
  id: string
  parentSpaceId?: string | null
  nodeIds: string[]
}

export function collectSpaceSubtree<TSpace extends SpaceTreeRecord>(
  spaces: TSpace[],
  rootSpaceId: string,
): TSpace[] {
  const spaceById = new Map(spaces.map(space => [space.id, space] as const))
  const root = spaceById.get(rootSpaceId) ?? null
  if (!root) {
    return []
  }

  const subtreeIds = new Set<string>([rootSpaceId])
  let changed = true

  while (changed) {
    changed = false
    for (const space of spaces) {
      if (space.parentSpaceId && subtreeIds.has(space.parentSpaceId) && !subtreeIds.has(space.id)) {
        subtreeIds.add(space.id)
        changed = true
      }
    }
  }

  return spaces.filter(space => subtreeIds.has(space.id))
}

export function collectSpaceSubtreeIds<TSpace extends SpaceTreeRecord>(
  spaces: TSpace[],
  rootSpaceId: string,
): Set<string> {
  return new Set(collectSpaceSubtree(spaces, rootSpaceId).map(space => space.id))
}

export function collectSpaceSubtreeNodeIds<TSpace extends SpaceTreeRecord>(
  spaces: TSpace[],
  rootSpaceId: string,
): Set<string> {
  return new Set(collectSpaceSubtree(spaces, rootSpaceId).flatMap(space => space.nodeIds))
}

export function mapNodeIdToOwningSpaceId<TSpace extends SpaceTreeRecord>(
  spaces: TSpace[],
): Map<string, string> {
  const result = new Map<string, string>()

  for (const space of spaces) {
    for (const nodeId of space.nodeIds) {
      if (!result.has(nodeId)) {
        result.set(nodeId, space.id)
      }
    }
  }

  return result
}

export function collectAncestorSpaces<TSpace extends SpaceTreeRecord>(
  spaces: TSpace[],
  spaceId: string,
): TSpace[] {
  const spaceById = new Map(spaces.map(space => [space.id, space] as const))
  const ancestors: TSpace[] = []
  const seen = new Set<string>([spaceId])
  let current = spaceById.get(spaceId) ?? null

  while (current?.parentSpaceId) {
    const parent = spaceById.get(current.parentSpaceId) ?? null
    if (!parent || seen.has(parent.id)) {
      break
    }

    ancestors.push(parent)
    seen.add(parent.id)
    current = parent
  }

  return ancestors
}
