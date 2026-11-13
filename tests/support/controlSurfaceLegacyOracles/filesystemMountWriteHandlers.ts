// @compat-file control-surface-legacy-validation
// Helper bodies also frozen from src/app/main/controlSurface/handlers/filesystemMountSupport.ts at fff23113f96951bba8004b432539633f7e3c29e0.
// Frozen legacy validators from src/app/main/controlSurface/handlers/filesystemMountWriteHandlers.ts at fff23113f96951bba8004b432539633f7e3c29e0.
// Bodies copied verbatim; imports relocated and exports added for parity.
import type { WriteFileTextInMountInput } from '../../../src/shared/contracts/dto'
import { createAppError } from '../../../src/shared/errors/appError'
import { optionalFileMutationBoolean } from './fileMutationOptions'
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
export const normalizeFilesystemWriteFileTextInMount = (
  payload: unknown,
): WriteFileTextInMountInput => {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for filesystem.writeFileTextInMount.',
    })
  }

  const content = payload.content
  if (typeof content !== 'string') {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for filesystem.writeFileTextInMount content.',
    })
  }

  return {
    mountId: normalizeMountId(payload.mountId, 'filesystem.writeFileTextInMount'),
    uri: normalizeFileSystemUri(payload.uri, 'filesystem.writeFileTextInMount'),
    content,
    overwrite: optionalFileMutationBoolean(payload.overwrite),
  }
}
