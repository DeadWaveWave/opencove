import type {
  AppErrorDescriptor,
  CreateMountInput,
  GetEndpointHomeDirectoryInput,
  ListMountsInput,
  PingWorkerEndpointInput,
  PrepareWorkerEndpointInput,
  RegisterManagedSshWorkerEndpointInput,
  ReadEndpointDirectoryInput,
  RegisterWorkerEndpointInput,
  PromoteMountInput,
  RepairWorkerEndpointInput,
  RemoveMountInput,
  RemoveWorkerEndpointInput,
  ResolveMountTargetInput,
  UpdateManagedSshWorkerEndpointInput,
} from '../../../../shared/contracts/dto'
import { createAppError } from '../../../../shared/errors/appError'
import { parseOptionalManagedSshPort } from '../../../../contexts/topology/domain/managedSshPort'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function isUnknownControlSurfaceOperationError(
  error: AppErrorDescriptor | null | undefined,
  operationId: string,
): boolean {
  if (!error) {
    return false
  }

  if (error.code !== 'common.invalid_input') {
    return false
  }

  const debugMessage = typeof error.debugMessage === 'string' ? error.debugMessage : ''
  return debugMessage.includes('Unknown control surface') && debugMessage.includes(operationId)
}

function normalizeOptionalString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null
  }

  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeRequiredString(value: unknown, debugName: string): string {
  const normalized = normalizeOptionalString(value)
  if (!normalized) {
    throw createAppError('common.invalid_input', { debugMessage: `Missing ${debugName}.` })
  }

  return normalized
}

function normalizeRequiredPort(value: unknown, debugName: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw createAppError('common.invalid_input', { debugMessage: `Invalid ${debugName}.` })
  }

  const port = Math.floor(value)
  if (port <= 0 || port > 65_535) {
    throw createAppError('common.invalid_input', { debugMessage: `Invalid ${debugName}.` })
  }

  return port
}

function normalizeOptionalManagedSshPort(value: unknown, debugName: string): number | null {
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

function isAbsolutePathLike(pathValue: string): boolean {
  return /^([a-zA-Z]:[\\/]|\\\\|\/)/.test(pathValue)
}

function normalizeRequiredAbsolutePath(value: unknown, debugName: string): string {
  const path = normalizeRequiredString(value, debugName)
  if (!isAbsolutePathLike(path)) {
    throw createAppError('common.invalid_input', {
      debugMessage: `${debugName} requires an absolute path`,
    })
  }

  return path
}

export function normalizeRegisterEndpointPayload(payload: unknown): RegisterWorkerEndpointInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for endpoint.register.',
    })
  }

  return {
    displayName: normalizeOptionalString(payload.displayName),
    hostname: normalizeRequiredString(payload.hostname, 'endpoint.register hostname'),
    port: normalizeRequiredPort(payload.port, 'endpoint.register port'),
    token: normalizeRequiredString(payload.token, 'endpoint.register token'),
  }
}

export function normalizeRemoveEndpointPayload(payload: unknown): RemoveWorkerEndpointInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for endpoint.remove.',
    })
  }

  const expectedMountCount = payload.expectedMountCount
  if (
    expectedMountCount !== null &&
    expectedMountCount !== undefined &&
    (!Number.isSafeInteger(expectedMountCount) || Number(expectedMountCount) < 0)
  ) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid endpoint.remove expectedMountCount.',
    })
  }

  return {
    endpointId: normalizeRequiredString(payload.endpointId, 'endpoint.remove endpointId'),
    ...(typeof expectedMountCount === 'number' ? { expectedMountCount } : {}),
  }
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

export function normalizeListMountsPayload(payload: unknown): ListMountsInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for mount.list.',
    })
  }

  return {
    projectId: normalizeRequiredString(payload.projectId, 'mount.list projectId'),
  }
}

export function normalizeCreateMountPayload(payload: unknown): CreateMountInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for mount.create.',
    })
  }

  return {
    projectId: normalizeRequiredString(payload.projectId, 'mount.create projectId'),
    name: normalizeOptionalString(payload.name),
    endpointId: normalizeRequiredString(payload.endpointId, 'mount.create endpointId'),
    rootPath: normalizeRequiredString(payload.rootPath, 'mount.create rootPath'),
  }
}

export function normalizeRemoveMountPayload(payload: unknown): RemoveMountInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for mount.remove.',
    })
  }

  return { mountId: normalizeRequiredString(payload.mountId, 'mount.remove mountId') }
}

export function normalizePromoteMountPayload(payload: unknown): PromoteMountInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for mount.promote.',
    })
  }

  return { mountId: normalizeRequiredString(payload.mountId, 'mount.promote mountId') }
}

export function normalizeResolveMountTargetPayload(payload: unknown): ResolveMountTargetInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for mountTarget.resolve.',
    })
  }

  return { mountId: normalizeRequiredString(payload.mountId, 'mountTarget.resolve mountId') }
}

export function normalizePingEndpointPayload(payload: unknown): PingWorkerEndpointInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for endpoint.ping.',
    })
  }

  const timeoutMsRaw = payload.timeoutMs
  const timeoutMs =
    typeof timeoutMsRaw === 'number' && Number.isFinite(timeoutMsRaw) && timeoutMsRaw > 0
      ? Math.floor(timeoutMsRaw)
      : null

  return {
    endpointId: normalizeRequiredString(payload.endpointId, 'endpoint.ping endpointId'),
    ...(timeoutMs !== null ? { timeoutMs } : {}),
  }
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
    action,
  }
}

export function normalizeEndpointHomeDirectoryPayload(
  payload: unknown,
): GetEndpointHomeDirectoryInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for endpoint.homeDirectory.',
    })
  }

  return {
    endpointId: normalizeRequiredString(payload.endpointId, 'endpoint.homeDirectory endpointId'),
  }
}

export function normalizeEndpointReadDirectoryPayload(
  payload: unknown,
): ReadEndpointDirectoryInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for endpoint.readDirectory.',
    })
  }

  return {
    endpointId: normalizeRequiredString(payload.endpointId, 'endpoint.readDirectory endpointId'),
    path: normalizeRequiredAbsolutePath(payload.path, 'endpoint.readDirectory path'),
  }
}
