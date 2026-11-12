// Frozen from src/app/main/controlSurface/handlers/filesystemMountSupport.ts at 6df96903c64d6fb3c541c79815713996d3c1b186
import { createAppError } from '../../../src/shared/errors/appError'
export function isRecord(value: unknown): value is Record<string, unknown> {
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

export function normalizeMountId(value: unknown, operationId: string): string {
  const mountId = normalizeOptionalString(value)
  if (!mountId) {
    throw createAppError('common.invalid_input', {
      debugMessage: `Missing payload for ${operationId} mountId.`,
    })
  }

  return mountId
}

export function normalizeFileSystemUri(uri: unknown, operationId: string): string {
  if (typeof uri !== 'string') {
    throw createAppError('common.invalid_input', {
      debugMessage: `Invalid payload for ${operationId} uri.`,
    })
  }

  const normalized = uri.trim()
  if (normalized.length === 0) {
    throw createAppError('common.invalid_input', {
      debugMessage: `Missing payload for ${operationId} uri.`,
    })
  }

  let parsed: URL
  try {
    parsed = new URL(normalized)
  } catch {
    throw createAppError('common.invalid_input', {
      debugMessage: `Invalid payload for ${operationId} uri.`,
    })
  }

  if (parsed.protocol !== 'file:') {
    throw createAppError('common.invalid_input', {
      debugMessage: `Unsupported uri scheme for ${operationId}: ${parsed.protocol}`,
    })
  }

  return normalized
}

export function normalizeSourceTargetPayload<
  T extends { mountId: string; sourceUri: string; targetUri: string },
>(payload: unknown, operationId: string): T {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: `Invalid payload for ${operationId}.`,
    })
  }

  return {
    mountId: normalizeMountId(payload.mountId, operationId),
    sourceUri: normalizeFileSystemUri(payload.sourceUri, `${operationId}.sourceUri`),
    targetUri: normalizeFileSystemUri(payload.targetUri, `${operationId}.targetUri`),
  } as T
}
