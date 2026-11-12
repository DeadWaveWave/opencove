import { createAppError } from '../../../errors/appError'
import type { WriteFileTextInput } from '../../dto'
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
      debugMessage: `Unsupported uri scheme for ${operationId}: unsupported scheme`,
    })
  }

  return normalized
}

export function normalizeWriteFileTextPayload(payload: unknown): WriteFileTextInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for filesystem.writeFileText.',
    })
  }

  const content = payload.content
  if (typeof content !== 'string') {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for filesystem.writeFileText content.',
    })
  }

  return {
    uri: normalizeFileSystemUri(payload.uri, 'filesystem.writeFileText'),
    content,
    overwrite: optionalFileMutationBoolean(payload.overwrite),
  }
}

export function optionalFileMutationBoolean(value: unknown): boolean | undefined {
  if (value === undefined || typeof value === 'boolean') {
    return value
  }
  throw createAppError('common.invalid_input', { debugMessage: 'Invalid file mutation option.' })
}
