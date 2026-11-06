// Frozen oracle: copied from src/app/main/controlSurface/handlers/filesystemHandlers.ts at 90f8a89ba50d70147773c4e04ba15c31063d393c; do not edit; delete when the parity window closes.
import { createAppError } from '../../../src/shared/errors/appError'
import type { WriteFileTextInput } from '../../../src/shared/contracts/dto'
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

/** Older Workers must reject strict semantics instead of silently ignoring their options. */
export const FILE_MUTATION_CAPABILITIES = {
  exclusiveWrite: true,
  nonRecursiveDelete: true,
} as const
