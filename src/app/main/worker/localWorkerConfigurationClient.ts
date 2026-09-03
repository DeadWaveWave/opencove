import type {
  HomeWorkerConfigDto,
  HomeWorkerConfigurationSnapshotDto,
  WorkerConnectionInfoDto,
  WorkerWebAccessRuntimeStatusDto,
} from '../../../shared/contracts/dto'
import type { ControlSurfaceInvokeRequest } from '../../../shared/contracts/controlSurface'
import { createAppError } from '../../../shared/errors/appError'
import { invokeControlSurface } from '../controlSurface/remote/controlSurfaceHttpClient'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isValidPort(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0 && (value as number) <= 65_535
}

function normalizeGenerationArray(value: unknown): number[] | null {
  if (
    !Array.isArray(value) ||
    value.some(item => !Number.isSafeInteger(item) || (item as number) < 0)
  ) {
    return null
  }
  return [...value] as number[]
}

function normalizeWebAccessStatus(value: unknown): WorkerWebAccessRuntimeStatusDto | null {
  if (
    !isRecord(value) ||
    !Number.isSafeInteger(value.generation) ||
    (value.generation as number) < 0
  ) {
    return null
  }
  const drainingGenerations = normalizeGenerationArray(value.drainingGenerations)
  if (!drainingGenerations) {
    return null
  }
  const generation = value.generation as number
  if (value.state === 'disabled') {
    return { state: 'disabled', generation, drainingGenerations }
  }
  if (value.state === 'failed' && isNonEmptyString(value.error)) {
    return { state: 'failed', generation, error: value.error, drainingGenerations }
  }
  if (
    (value.state === 'active' || value.state === 'degraded') &&
    isNonEmptyString(value.hostname) &&
    isNonEmptyString(value.bindHostname) &&
    isValidPort(value.port) &&
    typeof value.passwordRequired === 'boolean' &&
    (value.state !== 'degraded' || isNonEmptyString(value.error))
  ) {
    const common = {
      generation,
      hostname: value.hostname,
      bindHostname: value.bindHostname,
      port: value.port as number,
      passwordRequired: value.passwordRequired,
      drainingGenerations,
    }
    return value.state === 'degraded'
      ? { state: 'degraded', ...common, error: value.error as string }
      : { state: 'active', ...common }
  }
  return null
}

function normalizeConfig(value: unknown): HomeWorkerConfigDto | null {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.webUi)) {
    return null
  }
  if (value.mode !== 'standalone' && value.mode !== 'local' && value.mode !== 'remote') {
    return null
  }
  const remote = value.remote
  const validRemote =
    remote !== null &&
    isRecord(remote) &&
    isNonEmptyString(remote.hostname) &&
    isValidPort(remote.port) &&
    isNonEmptyString(remote.token)
  if ((value.mode === 'remote' && !validRemote) || (value.mode !== 'remote' && remote !== null)) {
    return null
  }
  if (
    typeof value.webUi.enabled !== 'boolean' ||
    (value.webUi.port !== null && !isValidPort(value.webUi.port)) ||
    typeof value.webUi.exposeOnLan !== 'boolean' ||
    typeof value.webUi.passwordSet !== 'boolean' ||
    (value.webUi.exposeOnLan === true && value.webUi.passwordSet !== true) ||
    (value.updatedAt !== null &&
      (!isNonEmptyString(value.updatedAt) || !Number.isFinite(Date.parse(value.updatedAt))))
  ) {
    return null
  }
  return value as unknown as HomeWorkerConfigDto
}

export function normalizeHomeWorkerConfigurationSnapshot(
  value: unknown,
): HomeWorkerConfigurationSnapshotDto {
  if (!isRecord(value)) {
    throw createAppError('worker.unavailable', {
      debugMessage: 'Invalid Worker configuration response.',
    })
  }
  const config = normalizeConfig(value.config)
  const webAccess = normalizeWebAccessStatus(value.webAccess)
  if (!config || !webAccess) {
    throw createAppError('worker.unavailable', {
      debugMessage: 'Invalid Worker configuration response.',
    })
  }
  return { config, webAccess }
}

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
    throw createAppError(result.error)
  }
  return normalizeHomeWorkerConfigurationSnapshot(result.value)
}
