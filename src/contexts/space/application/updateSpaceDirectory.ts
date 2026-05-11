import type { SpaceBoundary } from '../../../shared/types/spaceBoundary'
import { replaceBoundaryScopeRoot, resolveSpaceBoundaryScope } from './spaceBoundaryPolicy'

export interface UpdateSpaceDirectoryOptions {
  markNodeDirectoryMismatch?: boolean
  archiveSpace?: boolean
  renameSpaceTo?: string
}

export interface SpaceDirectoryRecord {
  id: string
  name: string
  directoryPath: string
  targetMountId?: string | null
  parentSpaceId?: string | null
  boundary?: SpaceBoundary | null
  nodeIds: string[]
}

export interface SpaceDirectoryUpdateResult<TSpace extends SpaceDirectoryRecord> {
  nextSpaces: TSpace[]
  archiveSpace: boolean
  markNodeDirectoryMismatch: boolean
  targetNodeIds: Set<string>
  previousEffectiveDirectory: string
  nextDirectoryPath: string
}

export function computeSpaceDirectoryUpdate<TSpace extends SpaceDirectoryRecord>({
  workspacePath,
  spaces,
  spaceId,
  directoryPath,
  options,
}: {
  workspacePath: string
  spaces: TSpace[]
  spaceId: string
  directoryPath: string
  options?: UpdateSpaceDirectoryOptions
}): SpaceDirectoryUpdateResult<TSpace> | null {
  const targetSpace = spaces.find(space => space.id === spaceId) ?? null
  if (!targetSpace) {
    return null
  }

  const previousEffectiveDirectory =
    targetSpace.directoryPath.trim().length > 0 ? targetSpace.directoryPath : workspacePath

  const archiveSpace = options?.archiveSpace === true
  const markNodeDirectoryMismatch = options?.markNodeDirectoryMismatch === true
  const renameSpaceTo = options?.renameSpaceTo?.trim()
  const removedSpaceIds = archiveSpace ? collectDescendantSpaceIds(spaces, spaceId) : new Set()
  const cascadedSpaceIds = archiveSpace
    ? new Set<string>()
    : collectInheritedDirectoryDescendantIds({
        spaces,
        parentSpaceId: spaceId,
        previousDirectoryPath: previousEffectiveDirectory,
      })
  const targetNodeIds = new Set(
    spaces
      .filter(
        space =>
          space.id === spaceId || removedSpaceIds.has(space.id) || cascadedSpaceIds.has(space.id),
      )
      .flatMap(space => space.nodeIds),
  )

  const nextSpaces = archiveSpace
    ? spaces.filter(space => !removedSpaceIds.has(space.id))
    : spaces.map(space =>
        space.id === spaceId || cascadedSpaceIds.has(space.id)
          ? updateSpaceDirectoryProjection({
              space,
              directoryPath,
              renameSpaceTo: space.id === spaceId ? renameSpaceTo : null,
            })
          : space,
      )

  return {
    nextSpaces,
    archiveSpace,
    markNodeDirectoryMismatch,
    targetNodeIds,
    previousEffectiveDirectory,
    nextDirectoryPath: directoryPath,
  }
}

function collectDescendantSpaceIds<TSpace extends SpaceDirectoryRecord>(
  spaces: TSpace[],
  rootSpaceId: string,
): Set<string> {
  const removed = new Set<string>([rootSpaceId])
  let changed = true

  while (changed) {
    changed = false
    for (const space of spaces) {
      if (space.parentSpaceId && removed.has(space.parentSpaceId) && !removed.has(space.id)) {
        removed.add(space.id)
        changed = true
      }
    }
  }

  return removed
}

function collectInheritedDirectoryDescendantIds<TSpace extends SpaceDirectoryRecord>({
  spaces,
  parentSpaceId,
  previousDirectoryPath,
}: {
  spaces: TSpace[]
  parentSpaceId: string
  previousDirectoryPath: string
}): Set<string> {
  const result = new Set<string>()
  const previous = previousDirectoryPath.trim()
  if (!previous) {
    return result
  }

  let changed = true
  while (changed) {
    changed = false
    for (const space of spaces) {
      const parentMatches =
        space.parentSpaceId === parentSpaceId ||
        (space.parentSpaceId !== null &&
          space.parentSpaceId !== undefined &&
          result.has(space.parentSpaceId))
      if (!parentMatches || result.has(space.id)) {
        continue
      }

      const scope = resolveSpaceBoundaryScope(space.boundary, space.targetMountId)
      const inheritedDirectory =
        space.directoryPath.trim() === previous || scope?.rootPath.trim() === previous
      if (!inheritedDirectory) {
        continue
      }

      result.add(space.id)
      changed = true
    }
  }

  return result
}

function updateSpaceDirectoryProjection<TSpace extends SpaceDirectoryRecord>({
  space,
  directoryPath,
  renameSpaceTo,
}: {
  space: TSpace
  directoryPath: string
  renameSpaceTo?: string | null
}): TSpace {
  return {
    ...space,
    directoryPath,
    boundary: replaceBoundaryScopeRoot({
      boundary: space.boundary,
      mountId: space.targetMountId,
      rootPath: directoryPath,
    }),
    name: renameSpaceTo && renameSpaceTo.length > 0 ? renameSpaceTo : space.name,
  }
}
