import type {
  HomeWorkerConfigurationSnapshotDto,
  WorkerConnectionInfoDto,
} from '../../../shared/contracts/dto'
import type { ControlSurfaceInvokeRequest } from '../../../shared/contracts/controlSurface'
import { createAppError } from '../../../shared/errors/appError'
import {
  normalizeHomeWorkerConfigurationFailureDetails,
  normalizeHomeWorkerConfigurationSnapshot,
} from '../../../shared/runtime/homeWorkerConfigurationValidation'
import { invokeControlSurface } from '../controlSurface/remote/controlSurfaceHttpClient'

export {
  normalizeHomeWorkerConfigurationFailureDetails,
  normalizeHomeWorkerConfigurationSnapshot,
} from '../../../shared/runtime/homeWorkerConfigurationValidation'

export async function invokeLocalWorkerConfiguration(
  connection: WorkerConnectionInfoDto,
  request: ControlSurfaceInvokeRequest,
): Promise<HomeWorkerConfigurationSnapshotDto> {
  const { httpStatus, result } = await invokeControlSurface(
    {
      hostname: connection.hostname,
      port: connection.port,
      token: connection.token,
    },
    request,
  )
  if (httpStatus !== 200 || !result) {
    throw createAppError('worker.unavailable', {
      debugMessage: `Worker configuration request failed with HTTP ${httpStatus}.`,
    })
  }
  if (!result.ok) {
    if (result.error.details === undefined) {
      throw createAppError(result.error)
    }
    throw createAppError({
      ...result.error,
      details: normalizeHomeWorkerConfigurationFailureDetails(result.error.details),
    })
  }
  return normalizeHomeWorkerConfigurationSnapshot(result.value)
}
