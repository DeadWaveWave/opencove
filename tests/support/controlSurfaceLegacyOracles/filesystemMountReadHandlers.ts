// @compat-file control-surface-legacy-validation
// Helper bodies also frozen from src/app/main/controlSurface/handlers/filesystemMountSupport.ts at fff23113f96951bba8004b432539633f7e3c29e0.
// Frozen legacy validators from src/app/main/controlSurface/handlers/filesystemMountReadHandlers.ts at fff23113f96951bba8004b432539633f7e3c29e0.
// Bodies copied verbatim; imports relocated and exports added for parity.
import type { ReadFileTextInMountInput } from '../../../src/shared/contracts/dto'
import { createAppError } from '../../../src/shared/errors/appError'
import { normalizeFileReadLimit } from './fileReadLimits'
import type { StatInMountInput } from '../../../src/shared/contracts/dto'
import type { ReadDirectoryInMountInput } from '../../../src/shared/contracts/dto'
function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function normalizeMountId(value: unknown, operationId: string): string {
  const mountId = normalizeOptionalString(value)
  if (!mountId) {
    throw createAppError('common.invalid_input', {
      debugMessage: `Missing payload for ${operationId} mountId.`,
    })
  }

  return mountId
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

function normalizeFileSystemUri(uri: unknown, operationId: string): string {
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
export const normalizeFilesystemReadFileTextInMount = (
  payload: unknown,
): ReadFileTextInMountInput => {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for filesystem.readFileTextInMount.',
    })
  }

  return {
    mountId: normalizeMountId(payload.mountId, 'filesystem.readFileTextInMount'),
    uri: normalizeFileSystemUri(payload.uri, 'filesystem.readFileTextInMount'),
    maxBytes: normalizeFileReadLimit(payload.maxBytes, 1024 * 1024),
  }
}
export const normalizeFilesystemStatInMount = (payload: unknown): StatInMountInput => {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for filesystem.statInMount.',
    })
  }

  return {
    mountId: normalizeMountId(payload.mountId, 'filesystem.statInMount'),
    uri: normalizeFileSystemUri(payload.uri, 'filesystem.statInMount'),
  }
}
export const normalizeFilesystemReadDirectoryInMount = (
  payload: unknown,
): ReadDirectoryInMountInput => {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for filesystem.readDirectoryInMount.',
    })
  }

  return {
    mountId: normalizeMountId(payload.mountId, 'filesystem.readDirectoryInMount'),
    uri: normalizeFileSystemUri(payload.uri, 'filesystem.readDirectoryInMount'),
    maxEntries: normalizeFileReadLimit(payload.maxEntries, 1000),
  }
}
