import type { HomeWorkerConfigFile } from '../../contexts/settings/domain/homeWorkerConfig'
import { createWorkerWebAccessOwner } from '../../contexts/settings/application/workerWebAccess/workerWebAccessOwner'
import type { WorkerWebAccessPort } from '../../contexts/settings/application/workerWebAccess/workerWebAccessTypes'
import type { ControlSurfaceHttpRuntime } from '../main/controlSurface/controlSurfaceHttpRuntime.contract'

export type {
  WorkerWebAccessRuntime,
  WorkerWebAccessRuntimeStatus,
} from '../../contexts/settings/application/workerWebAccess/workerWebAccessTypes'

export function createWorkerWebAccessRuntime(options: {
  controlSurfaceRuntime: ControlSurfaceHttpRuntime
  initialConfig: HomeWorkerConfigFile
  persist: Parameters<typeof createWorkerWebAccessOwner>[0]['persist']
  drainTimeoutMs?: number
}): ReturnType<typeof createWorkerWebAccessOwner> {
  const runtime: WorkerWebAccessPort = {
    listen: input => options.controlSurfaceRuntime.listen(input),
    setWebAccessPolicy: policy => options.controlSurfaceRuntime.setWebAccessPolicy(policy),
    rotateWebSessionGeneration: () => options.controlSurfaceRuntime.rotateWebSessionGeneration(),
    closePtyStreamClients: filter => options.controlSurfaceRuntime.closePtyStreamClients(filter),
  }
  return createWorkerWebAccessOwner({
    runtime,
    initialConfig: options.initialConfig,
    persist: options.persist,
    ...(options.drainTimeoutMs === undefined ? {} : { drainTimeoutMs: options.drainTimeoutMs }),
  })
}
