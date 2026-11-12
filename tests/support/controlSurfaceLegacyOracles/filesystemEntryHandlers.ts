// Frozen validator bodies from src/app/main/controlSurface/handlers/filesystemHandlers.ts at 6df96903c64d6fb3c541c79815713996d3c1b186; imports relocated only.
import { optionalFileMutationBoolean } from './filesystemMutationOptions'
import { createAppError } from '../../../src/shared/errors/appError'
import type {
  CopyEntryInput,
  CreateDirectoryInput,
  DeleteEntryInput,
  MoveEntryInput,
  ReadFileBytesInput,
  RenameEntryInput,
} from '../../../src/shared/contracts/dto'
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

function normalizeReadFileBytesPayload(payload: unknown): ReadFileBytesInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for filesystem.readFileBytes.',
    })
  }

  return {
    uri: normalizeFileSystemUri(payload.uri, 'filesystem.readFileBytes'),
  }
}

function normalizeSourceTargetPayload<T extends CopyEntryInput | MoveEntryInput | RenameEntryInput>(
  payload: unknown,
  operationId: string,
): T {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: `Invalid payload for ${operationId}.`,
    })
  }

  return {
    sourceUri: normalizeFileSystemUri(payload.sourceUri, `${operationId}.sourceUri`),
    targetUri: normalizeFileSystemUri(payload.targetUri, `${operationId}.targetUri`),
  } as T
}

function normalizeCopyEntryPayload(payload: unknown): CopyEntryInput {
  return normalizeSourceTargetPayload<CopyEntryInput>(payload, 'filesystem.copyEntry')
}

function normalizeMoveEntryPayload(payload: unknown): MoveEntryInput {
  return normalizeSourceTargetPayload<MoveEntryInput>(payload, 'filesystem.moveEntry')
}

function normalizeRenameEntryPayload(payload: unknown): RenameEntryInput {
  return normalizeSourceTargetPayload<RenameEntryInput>(payload, 'filesystem.renameEntry')
}

function normalizeCreateDirectoryPayload(payload: unknown): CreateDirectoryInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for filesystem.createDirectory.',
    })
  }

  return {
    uri: normalizeFileSystemUri(payload.uri, 'filesystem.createDirectory'),
  }
}

function normalizeDeleteEntryPayload(payload: unknown): DeleteEntryInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for filesystem.deleteEntry.',
    })
  }

  return {
    uri: normalizeFileSystemUri(payload.uri, 'filesystem.deleteEntry'),
    recursive: optionalFileMutationBoolean(payload.recursive),
  }
}

export const normalizeFilesystemReadFileBytes = normalizeReadFileBytesPayload
export const normalizeFilesystemCreateDirectory = normalizeCreateDirectoryPayload
export const normalizeFilesystemCopyEntry = normalizeCopyEntryPayload
export const normalizeFilesystemMoveEntry = normalizeMoveEntryPayload
export const normalizeFilesystemRenameEntry = normalizeRenameEntryPayload
export const normalizeFilesystemDeleteEntry = normalizeDeleteEntryPayload
