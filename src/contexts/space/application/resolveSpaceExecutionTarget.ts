import { toFileUri } from '@contexts/filesystem/domain/fileUri'
import type { MountTarget } from '../domain/mountTarget'

export interface SpaceLike {
  id: string
  directoryPath: string
  nodeIds: string[]
}

export interface SpaceExecutionTarget {
  workingDirectory: string
  mountTarget: MountTarget
}

export function resolveSpaceExecutionTarget({
  spaces,
  nodeId,
  workspacePath,
}: {
  spaces: SpaceLike[]
  nodeId: string
  workspacePath: string
}): SpaceExecutionTarget {
  const owningSpace = spaces.find(space => space.nodeIds.includes(nodeId)) ?? null
  const workingDirectory =
    owningSpace && owningSpace.directoryPath.trim().length > 0
      ? owningSpace.directoryPath
      : workspacePath

  return {
    workingDirectory,
    mountTarget: {
      scheme: 'file',
      rootPath: workingDirectory,
      rootUri: toFileUri(workingDirectory),
    },
  }
}
