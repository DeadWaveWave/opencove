// Frozen legacy validators from src/app/main/controlSurface/handlers/topologyHandlerPayloads.ts (validators) and handlers/topologyHandlers.ts (registration) at fff23113f96951bba8004b432539633f7e3c29e0.
// Bodies copied verbatim; imports relocated and exports added for parity.
import type { RegisterWorkerEndpointInput } from '../../../src/shared/contracts/dto'
import { createAppError } from '../../../src/shared/errors/appError'
import type { RemoveWorkerEndpointInput } from '../../../src/shared/contracts/dto'
import type { PingWorkerEndpointInput } from '../../../src/shared/contracts/dto'
import type { ListMountsInput } from '../../../src/shared/contracts/dto'
import type { CreateMountInput } from '../../../src/shared/contracts/dto'
import type { RemoveMountInput } from '../../../src/shared/contracts/dto'
import type { ResolveMountTargetInput } from '../../../src/shared/contracts/dto'
function normalizeRegisterEndpointPayload(payload: unknown): RegisterWorkerEndpointInput {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
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

function normalizeRemoveEndpointPayload(payload: unknown): RemoveWorkerEndpointInput {
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

function normalizePingEndpointPayload(payload: unknown): PingWorkerEndpointInput {
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

function normalizeListMountsPayload(payload: unknown): ListMountsInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for mount.list.',
    })
  }

  return {
    projectId: normalizeRequiredString(payload.projectId, 'mount.list projectId'),
  }
}

function normalizeCreateMountPayload(payload: unknown): CreateMountInput {
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

function normalizeRemoveMountPayload(payload: unknown): RemoveMountInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for mount.remove.',
    })
  }

  return { mountId: normalizeRequiredString(payload.mountId, 'mount.remove mountId') }
}

function normalizeResolveMountTargetPayload(payload: unknown): ResolveMountTargetInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for mountTarget.resolve.',
    })
  }

  return { mountId: normalizeRequiredString(payload.mountId, 'mountTarget.resolve mountId') }
}
export const normalizeEndpointList = (payload: unknown) => payload ?? null
export const normalizeEndpointRegister = normalizeRegisterEndpointPayload
export const normalizeEndpointRemove = normalizeRemoveEndpointPayload
export const normalizeEndpointPing = normalizePingEndpointPayload
export const normalizeMountList = normalizeListMountsPayload
export const normalizeMountCreate = normalizeCreateMountPayload
export const normalizeMountRemove = normalizeRemoveMountPayload
export const normalizeMountTargetResolve = normalizeResolveMountTargetPayload
