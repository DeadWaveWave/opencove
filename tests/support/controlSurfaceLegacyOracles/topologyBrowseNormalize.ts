// @compat-file control-surface-legacy-validation
// Frozen from src/app/main/controlSurface/handlers/topologyHandlerPayloads.ts at 6df96903c64d6fb3c541c79815713996d3c1b186. Function bodies unchanged.
import type {
  GetEndpointHomeDirectoryInput,
  PromoteMountInput,
  ReadEndpointDirectoryInput,
} from '../../../src/shared/contracts/dto'
import { createAppError } from '../../../src/shared/errors/appError'
export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function normalizeSshConfigHostsPayload(payload: unknown): null {
  if (payload !== null && payload !== undefined) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for endpoint.sshConfigHosts.',
    })
  }
  return null
}

export function normalizeOptionalString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null
  }

  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function normalizeRequiredString(value: unknown, debugName: string): string {
  const normalized = normalizeOptionalString(value)
  if (!normalized) {
    throw createAppError('common.invalid_input', { debugMessage: `Missing ${debugName}.` })
  }

  return normalized
}

export function isAbsolutePathLike(pathValue: string): boolean {
  return /^([a-zA-Z]:[\\/]|\\\\|\/)/.test(pathValue)
}

export function normalizeRequiredAbsolutePath(value: unknown, debugName: string): string {
  const path = normalizeRequiredString(value, debugName)
  if (!isAbsolutePathLike(path)) {
    throw createAppError('common.invalid_input', {
      debugMessage: `${debugName} requires an absolute path`,
    })
  }

  return path
}

export function normalizePromoteMountPayload(payload: unknown): PromoteMountInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for mount.promote.',
    })
  }

  return { mountId: normalizeRequiredString(payload.mountId, 'mount.promote mountId') }
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
