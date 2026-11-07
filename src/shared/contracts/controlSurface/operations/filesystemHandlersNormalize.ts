import { createAppError } from '../../../errors/appError'
import type { ReadDirectoryInput, ReadFileTextInput, StatInput } from '../../dto'
import { normalizeFileReadLimit } from '../../fileReadLimits'
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
