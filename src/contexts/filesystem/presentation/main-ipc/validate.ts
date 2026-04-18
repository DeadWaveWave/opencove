import type {
  CopyEntryInput,
  CreateDirectoryInput,
  DeleteEntryInput,
  MoveEntryInput,
  ReadDirectoryInput,
  ReadFileBytesInput,
  ReadFileTextInput,
  RenameEntryInput,
  StatInput,
  WriteFileTextInput,
} from '../../../../shared/contracts/dto'
import { createAppError } from '../../../../shared/errors/appError'

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

export function normalizeReadFileTextPayload(payload: unknown): ReadFileTextInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for filesystem:read-file-text.',
    })
  }

  return {
    uri: normalizeFileSystemUri(payload.uri, 'filesystem:read-file-text'),
  }
}

export function normalizeReadFileBytesPayload(payload: unknown): ReadFileBytesInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for filesystem:read-file-bytes.',
    })
  }

  return {
    uri: normalizeFileSystemUri(payload.uri, 'filesystem:read-file-bytes'),
  }
}

export function normalizeWriteFileTextPayload(payload: unknown): WriteFileTextInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for filesystem:write-file-text.',
    })
  }

  const content = payload.content
  if (typeof content !== 'string') {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for filesystem:write-file-text content.',
    })
  }

  return {
    uri: normalizeFileSystemUri(payload.uri, 'filesystem:write-file-text'),
    content,
  }
}

function normalizeSourceTargetPayload<T extends CopyEntryInput | MoveEntryInput | RenameEntryInput>(
  payload: unknown,
  channel: string,
): T {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: `Invalid payload for ${channel}.`,
    })
  }

  return {
    sourceUri: normalizeFileSystemUri(payload.sourceUri, `${channel}:sourceUri`),
    targetUri: normalizeFileSystemUri(payload.targetUri, `${channel}:targetUri`),
  } as T
}

export function normalizeStatPayload(payload: unknown): StatInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for filesystem:stat.',
    })
  }

  return {
    uri: normalizeFileSystemUri(payload.uri, 'filesystem:stat'),
  }
}

export function normalizeReadDirectoryPayload(payload: unknown): ReadDirectoryInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for filesystem:read-directory.',
    })
  }

  return {
    uri: normalizeFileSystemUri(payload.uri, 'filesystem:read-directory'),
  }
}

export function normalizeCopyEntryPayload(payload: unknown): CopyEntryInput {
  return normalizeSourceTargetPayload<CopyEntryInput>(payload, 'filesystem:copy-entry')
}

export function normalizeMoveEntryPayload(payload: unknown): MoveEntryInput {
  return normalizeSourceTargetPayload<MoveEntryInput>(payload, 'filesystem:move-entry')
}

export function normalizeRenameEntryPayload(payload: unknown): RenameEntryInput {
  return normalizeSourceTargetPayload<RenameEntryInput>(payload, 'filesystem:rename-entry')
}

export function normalizeCreateDirectoryPayload(payload: unknown): CreateDirectoryInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for filesystem:create-directory.',
    })
  }

  return {
    uri: normalizeFileSystemUri(payload.uri, 'filesystem:create-directory'),
  }
}

export function normalizeDeleteEntryPayload(payload: unknown): DeleteEntryInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for filesystem:delete-entry.',
    })
  }

  return {
    uri: normalizeFileSystemUri(payload.uri, 'filesystem:delete-entry'),
  }
}
