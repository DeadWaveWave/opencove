import { resolveLocalWorkerEndpointRef } from '@contexts/project/application/resolveLocalWorkerEndpointRef'
import {
  resolveSpaceExecutionTarget,
  type SpaceLike,
} from '@contexts/space/application/resolveSpaceExecutionTarget'
import type { TaskExecutionContext } from '../domain/taskExecutionContext'

export function resolveTaskExecutionContext({
  spaces,
  taskNodeId,
  workspacePath,
}: {
  spaces: SpaceLike[]
  taskNodeId: string
  workspacePath: string
}): TaskExecutionContext {
  const endpoint = resolveLocalWorkerEndpointRef()
  const { workingDirectory, mountTarget } = resolveSpaceExecutionTarget({
    spaces,
    nodeId: taskNodeId,
    workspacePath,
  })

  return {
    endpoint,
    target: mountTarget,
    scope: {
      rootPath: mountTarget.rootPath,
      rootUri: mountTarget.rootUri,
    },
    workingDirectory,
  }
}
