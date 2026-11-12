// Frozen legacy validators from src/app/main/controlSurface/handlers/filesystemHandlers.ts at fff23113f96951bba8004b432539633f7e3c29e0.
// Bodies copied verbatim; imports relocated and exports added for parity.
import type { ReadFileTextInput } from '../../../src/shared/contracts/dto'
import { createAppError } from '../../../src/shared/errors/appError'
import { normalizeFileReadLimit } from './fileReadLimits'
import type { StatInput } from '../../../src/shared/contracts/dto'
import type { ReadDirectoryInput } from '../../../src/shared/contracts/dto'
function normalizeReadFileTextPayload(payload: unknown): ReadFileTextInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for filesystem.readFileText.',
    })
  }

  return {
    uri: normalizeFileSystemUri(payload.uri, 'filesystem.readFileText'),
    maxBytes: normalizeFileReadLimit(payload.maxBytes, 1024 * 1024),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object'
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

function normalizeStatPayload(payload: unknown): StatInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for filesystem.stat.',
    })
  }

  return {
    uri: normalizeFileSystemUri(payload.uri, 'filesystem.stat'),
  }
}

function normalizeReadDirectoryPayload(payload: unknown): ReadDirectoryInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for filesystem.readDirectory.',
    })
  }

  return {
    uri: normalizeFileSystemUri(payload.uri, 'filesystem.readDirectory'),
    maxEntries: normalizeFileReadLimit(payload.maxEntries, 1000),
  }
}
export const normalizeFilesystemReadFileText = normalizeReadFileTextPayload
export const normalizeFilesystemStat = normalizeStatPayload
export const normalizeFilesystemReadDirectory = normalizeReadDirectoryPayload
