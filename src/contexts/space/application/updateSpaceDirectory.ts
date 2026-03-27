export interface UpdateSpaceDirectoryOptions {
  markNodeDirectoryMismatch?: boolean
  archiveSpace?: boolean
  renameSpaceTo?: string
}

export interface SpaceDirectoryRecord {
  id: string
  name: string
  directoryPath: string
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
  const targetNodeIds = new Set(targetSpace.nodeIds)

  const nextSpaces = archiveSpace
    ? spaces.filter(space => space.id !== spaceId)
    : spaces.map(space =>
        space.id === spaceId
          ? {
              ...space,
              directoryPath,
              name: renameSpaceTo && renameSpaceTo.length > 0 ? renameSpaceTo : space.name,
            }
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
