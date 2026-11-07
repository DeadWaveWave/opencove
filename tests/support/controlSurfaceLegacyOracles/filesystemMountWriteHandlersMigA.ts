// Frozen validator bodies from src/app/main/controlSurface/handlers/filesystemMountWriteHandlers.ts at 6df96903c64d6fb3c541c79815713996d3c1b186; imports relocated only.
import { optionalFileMutationBoolean } from './migAMutationOptions'
import { createAppError } from '../../../src/shared/errors/appError'
import type {
  CopyEntryInMountInput,
  CreateDirectoryInMountInput,
  DeleteEntryInMountInput,
  MoveEntryInMountInput,
  RenameEntryInMountInput,
} from '../../../src/shared/contracts/dto'
import {
  isRecord,
  normalizeFileSystemUri,
  normalizeMountId,
  normalizeSourceTargetPayload,
} from './migAMountSupport'

export const normalizeFilesystemCreateDirectoryInMount = (
  payload: unknown,
): CreateDirectoryInMountInput => {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for filesystem.createDirectoryInMount.',
    })
  }

  return {
    mountId: normalizeMountId(payload.mountId, 'filesystem.createDirectoryInMount'),
    uri: normalizeFileSystemUri(payload.uri, 'filesystem.createDirectoryInMount'),
  }
}
export const normalizeFilesystemDeleteEntryInMount = (
  payload: unknown,
): DeleteEntryInMountInput => {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for filesystem.deleteEntryInMount.',
    })
  }

  return {
    mountId: normalizeMountId(payload.mountId, 'filesystem.deleteEntryInMount'),
    uri: normalizeFileSystemUri(payload.uri, 'filesystem.deleteEntryInMount'),
    recursive: optionalFileMutationBoolean(payload.recursive),
  }
}
export const normalizeFilesystemCopyEntryInMount = (payload: unknown) =>
  normalizeSourceTargetPayload<CopyEntryInMountInput>(payload, 'filesystem.copyEntryInMount')
export const normalizeFilesystemMoveEntryInMount = (payload: unknown) =>
  normalizeSourceTargetPayload<MoveEntryInMountInput>(payload, 'filesystem.moveEntryInMount')
export const normalizeFilesystemRenameEntryInMount = (payload: unknown) =>
  normalizeSourceTargetPayload<RenameEntryInMountInput>(payload, 'filesystem.renameEntryInMount')
