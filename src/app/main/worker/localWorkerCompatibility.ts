import type { WorkerConnectionInfoDto } from '../../../shared/contracts/dto'
import { readRuntimeAppVersion } from '../controlSurface/runtimeAppVersion'
import { isWorkerConnectionAlive } from './workerConnectionHealth'

function resolveExpectedDesktopAppVersion(connection: WorkerConnectionInfoDto): string | null {
  if (connection.startedBy !== 'desktop') {
    return null
  }

  const runtimeVersion = readRuntimeAppVersion()
  if (typeof runtimeVersion !== 'string' || runtimeVersion.length === 0) {
    return ''
  }

  return connection.appVersion === runtimeVersion ? runtimeVersion : ''
}

export async function isReusableLocalWorkerConnection(
  connection: WorkerConnectionInfoDto,
): Promise<boolean> {
  const expectedAppVersion = resolveExpectedDesktopAppVersion(connection)
  if (expectedAppVersion === '') {
    return false
  }

  return await isWorkerConnectionAlive(connection, { expectedAppVersion })
}
