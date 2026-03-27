import type { WorkerEndpointRef } from '@contexts/project/domain/workerEndpoint'
import type { MountTarget } from '@contexts/space/domain/mountTarget'

export interface ExecutionScope {
  rootPath: string
  rootUri: string
}

export interface TaskExecutionContext {
  endpoint: WorkerEndpointRef
  target: MountTarget
  scope: ExecutionScope
  workingDirectory: string
}
