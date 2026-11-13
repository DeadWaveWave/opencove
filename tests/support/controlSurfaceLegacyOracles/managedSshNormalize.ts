// @compat-file control-surface-legacy-validation
// Frozen from src/app/main/controlSurface/handlers/topologyHandlerPayloads.ts at 6df96903c64d6fb3c541c79815713996d3c1b186. Function bodies unchanged.
import type {
  PrepareWorkerEndpointInput,
  RegisterManagedSshWorkerEndpointInput,
  RepairWorkerEndpointInput,
  UpdateManagedSshWorkerEndpointInput,
} from '../../../src/shared/contracts/dto'
import { parseRuntimeBuildIdentity } from './runtimeBuild'
import { createAppError } from '../../../src/shared/errors/appError'
import { parseOptionalManagedSshPort } from './managedSshPort'
import {
  isRecord,
  normalizeOptionalString,
  normalizeRequiredString,
} from './topologyBrowseNormalize'
export function normalizeOptionalManagedSshPort(value: unknown, debugName: string): number | null {
  if (value === null || value === undefined) {
    return null
  }

  if (typeof value !== 'number') {
    throw createAppError('common.invalid_input', { debugMessage: `Invalid ${debugName}.` })
  }

  const result = parseOptionalManagedSshPort(String(value))
  if (result.state !== 'valid') {
    throw createAppError('common.invalid_input', { debugMessage: `Invalid ${debugName}.` })
  }

  return result.value
}

export function normalizeRegisterManagedSshEndpointPayload(
  payload: unknown,
): RegisterManagedSshWorkerEndpointInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for endpoint.registerManagedSsh.',
    })
  }

  const remotePlatform =
    payload.remotePlatform === 'posix' || payload.remotePlatform === 'windows'
      ? payload.remotePlatform
      : 'auto'

  return {
    displayName: normalizeOptionalString(payload.displayName),
    host: normalizeRequiredString(payload.host, 'endpoint.registerManagedSsh host'),
    port: normalizeOptionalManagedSshPort(payload.port, 'endpoint.registerManagedSsh port'),
    username: normalizeOptionalString(payload.username),
    remotePort: normalizeOptionalManagedSshPort(
      payload.remotePort,
      'endpoint.registerManagedSsh remotePort',
    ),
    remotePlatform,
  }
}

export function normalizeUpdateManagedSshEndpointPayload(
  payload: unknown,
): UpdateManagedSshWorkerEndpointInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for endpoint.updateManagedSsh.',
    })
  }

  const remotePort = normalizeOptionalManagedSshPort(
    payload.remotePort,
    'endpoint.updateManagedSsh remotePort',
  )
  if (remotePort === null) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Missing endpoint.updateManagedSsh remotePort.',
    })
  }

  const remotePlatform =
    payload.remotePlatform === 'posix' || payload.remotePlatform === 'windows'
      ? payload.remotePlatform
      : 'auto'

  return {
    endpointId: normalizeRequiredString(payload.endpointId, 'endpoint.updateManagedSsh endpointId'),
    displayName: normalizeOptionalString(payload.displayName),
    host: normalizeRequiredString(payload.host, 'endpoint.updateManagedSsh host'),
    port: normalizeOptionalManagedSshPort(payload.port, 'endpoint.updateManagedSsh port'),
    username: normalizeOptionalString(payload.username),
    remotePort,
    remotePlatform,
  }
}

export function normalizeTargetBuild(value: unknown) {
  if (value === undefined || value === null) {
    return undefined
  }
  const build = parseRuntimeBuildIdentity(value)
  if (!build) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid runtime build descriptor.',
    })
  }
  return build
}

export function normalizePrepareEndpointPayload(payload: unknown): PrepareWorkerEndpointInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for endpoint.prepare.',
    })
  }

  const reason =
    payload.reason === 'connect' || payload.reason === 'browse' || payload.reason === 'reconnect'
      ? payload.reason
      : null

  return {
    endpointId: normalizeRequiredString(payload.endpointId, 'endpoint.prepare endpointId'),
    ...(payload.runtimeBuild ? { runtimeBuild: normalizeTargetBuild(payload.runtimeBuild) } : {}),
    ...(reason ? { reason } : {}),
  }
}

export function normalizeRepairEndpointPayload(payload: unknown): RepairWorkerEndpointInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for endpoint.repair.',
    })
  }

  const action = payload.action
  if (
    action !== 'repair_credentials' &&
    action !== 'repair_tunnel' &&
    action !== 'install_runtime' &&
    action !== 'update_runtime' &&
    action !== 'retry'
  ) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid endpoint.repair action.',
    })
  }

  return {
    endpointId: normalizeRequiredString(payload.endpointId, 'endpoint.repair endpointId'),
    ...(payload.runtimeBuild ? { runtimeBuild: normalizeTargetBuild(payload.runtimeBuild) } : {}),
    action,
  }
}
