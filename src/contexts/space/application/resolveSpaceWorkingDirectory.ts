export interface SpaceDirectoryLike {
  directoryPath: string
}

export function resolveSpaceWorkingDirectory(
  space: SpaceDirectoryLike | null,
  workspacePath: string,
): string {
  return space && space.directoryPath.trim().length > 0 ? space.directoryPath : workspacePath
}
