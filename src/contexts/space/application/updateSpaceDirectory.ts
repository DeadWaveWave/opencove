import type { SpaceBoundary } from '../../../shared/types/spaceBoundary'
import { EMPTY_SPACE_BOUNDARY } from '../../../shared/types/spaceBoundary'
import { collectSpaceSubtreeIds } from './spaceTree'
import { replaceBoundaryScopeRoot, resolveSpaceBoundaryScope } from './spaceBoundaryPolicy'

export interface UpdateSpaceDirectoryOptions {
  markNodeDirectoryMismatch?: boolean
  archiveSpace?: boolean
  renameSpaceTo?: string
  targetMountId?: string | null
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
  const targetMountId = Object.prototype.hasOwnProperty.call(options ?? {}, 'targetMountId')
    ? (options?.targetMountId ?? null)
    : undefined
  const removedSpaceIds = archiveSpace ? collectSpaceSubtreeIds(spaces, spaceId) : new Set()
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
              targetMountId,
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
  targetMountId,
}: {
  space: TSpace
  directoryPath: string
  renameSpaceTo?: string | null
  targetMountId?: string | null
}): TSpace {
  const hasTargetMountOverride = targetMountId !== undefined
  const hasTargetMountField = Object.prototype.hasOwnProperty.call(space, 'targetMountId')
  const nextTargetMountId = hasTargetMountOverride ? targetMountId : (space.targetMountId ?? null)
  const nextBoundary =
    nextTargetMountId === null
      ? { ...EMPTY_SPACE_BOUNDARY }
      : replaceBoundaryScopeRoot({
          boundary: space.boundary,
          mountId: nextTargetMountId,
          rootPath: directoryPath,
        })

  const nextSpace = {
    ...space,
    directoryPath,
    boundary: nextBoundary,
    name: renameSpaceTo && renameSpaceTo.length > 0 ? renameSpaceTo : space.name,
  }

  return (
    hasTargetMountOverride || hasTargetMountField
      ? { ...nextSpace, targetMountId: nextTargetMountId }
      : nextSpace
  ) as TSpace
}
