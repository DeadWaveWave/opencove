export interface PinSortableWorkspaceSpace {
  id: string
  parentSpaceId?: string | null
  pinned?: boolean
  sortOrder?: number
}

export function isWorkspaceSpacePinned(space: PinSortableWorkspaceSpace): boolean {
  return space.pinned === true
}

function resolveSortableOrder(
  space: PinSortableWorkspaceSpace,
  indexBySpaceId: ReadonlyMap<string, number>,
): number {
  return typeof space.sortOrder === 'number' && Number.isFinite(space.sortOrder)
    ? Math.floor(space.sortOrder)
    : (indexBySpaceId.get(space.id) ?? Number.MAX_SAFE_INTEGER)
}

export function orderRootSpaces<T extends PinSortableWorkspaceSpace>(spaces: readonly T[]): T[] {
  const indexBySpaceId = new Map(spaces.map((space, index) => [space.id, index] as const))
  const knownSpaceIds = new Set(indexBySpaceId.keys())

  return spaces
    .filter(space => !space.parentSpaceId || !knownSpaceIds.has(space.parentSpaceId))
    .sort((left, right) => {
      const pinRank = Number(isWorkspaceSpacePinned(right)) - Number(isWorkspaceSpacePinned(left))
      if (pinRank !== 0) {
        return pinRank
      }

      const orderDifference =
        resolveSortableOrder(left, indexBySpaceId) - resolveSortableOrder(right, indexBySpaceId)
      if (orderDifference !== 0) {
        return orderDifference
      }

      return (indexBySpaceId.get(left.id) ?? 0) - (indexBySpaceId.get(right.id) ?? 0)
    })
}

function applyRootSpaceOrder<T extends PinSortableWorkspaceSpace>(
  spaces: T[],
  orderedRoots: readonly T[],
): T[] {
  const orderedById = new Map(
    orderedRoots.map((space, sortOrder) => {
      const normalized = space.sortOrder === sortOrder ? space : ({ ...space, sortOrder } as T)
      return [space.id, normalized] as const
    }),
  )

  let changed = false
  const nextSpaces = spaces.map(space => {
    const ordered = orderedById.get(space.id)
    if (!ordered || ordered === space) {
      return space
    }

    changed = true
    return ordered
  })

  return changed ? nextSpaces : spaces
}

export function setRootSpacePinned<T extends PinSortableWorkspaceSpace>(
  spaces: T[],
  spaceId: string,
  pinned: boolean,
): T[] {
  const orderedRoots = orderRootSpaces(spaces)
  const target = orderedRoots.find(space => space.id === spaceId) ?? null
  if (!target || isWorkspaceSpacePinned(target) === pinned) {
    return spaces
  }

  const updatedTarget = { ...target, pinned } as T
  const remainingRoots = orderedRoots.filter(space => space.id !== spaceId)
  const pinnedRoots = remainingRoots.filter(isWorkspaceSpacePinned)
  const unpinnedRoots = remainingRoots.filter(space => !isWorkspaceSpacePinned(space))
  const nextRoots = [...pinnedRoots, updatedTarget, ...unpinnedRoots]

  return applyRootSpaceOrder(spaces, nextRoots)
}

export function reorderRootSpacesWithinPinGroup<T extends PinSortableWorkspaceSpace>(
  spaces: T[],
  activeSpaceId: string,
  overSpaceId: string,
): T[] {
  if (activeSpaceId === overSpaceId) {
    return spaces
  }

  const orderedRoots = orderRootSpaces(spaces)
  const oldIndex = orderedRoots.findIndex(space => space.id === activeSpaceId)
  const newIndex = orderedRoots.findIndex(space => space.id === overSpaceId)
  if (oldIndex === -1 || newIndex === -1) {
    return spaces
  }

  if (
    isWorkspaceSpacePinned(orderedRoots[oldIndex]) !==
    isWorkspaceSpacePinned(orderedRoots[newIndex])
  ) {
    return spaces
  }

  const nextRoots = [...orderedRoots]
  const [activeSpace] = nextRoots.splice(oldIndex, 1)
  nextRoots.splice(newIndex, 0, activeSpace)
  return applyRootSpaceOrder(spaces, nextRoots)
}
