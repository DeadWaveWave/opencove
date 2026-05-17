import type { WorkerConnectionInfoDto } from '../../../shared/contracts/dto'
import {
  resolveLocalWorkerReusePolicy as resolveSharedLocalWorkerReusePolicy,
  type LocalWorkerReusePolicy,
} from '../../../shared/runtime/localWorkerReusePolicy'
import { readRuntimeAppVersion } from '../controlSurface/runtimeAppVersion'
import { isWorkerConnectionAlive } from './workerConnectionHealth'

export type { LocalWorkerReusePolicy }

export function resolveLocalWorkerReusePolicy(
  connection: Pick<WorkerConnectionInfoDto, 'appVersion' | 'startedBy'>,
  options: { launcherStartedBy: 'cli' | 'desktop' } = { launcherStartedBy: 'desktop' },
): LocalWorkerReusePolicy {
  return resolveSharedLocalWorkerReusePolicy(connection, {
    launcherStartedBy: options.launcherStartedBy,
    desktopAppVersion: readRuntimeAppVersion(),
  })
}

export async function isReusableLocalWorkerConnection(
  connection: WorkerConnectionInfoDto,
): Promise<boolean> {
  const policy = resolveLocalWorkerReusePolicy(connection)
  if (!policy.canReuse) {
    return false
  }

  return await isWorkerConnectionAlive(connection, {
    expectedAppVersion: policy.expectedAppVersion,
  })
}
