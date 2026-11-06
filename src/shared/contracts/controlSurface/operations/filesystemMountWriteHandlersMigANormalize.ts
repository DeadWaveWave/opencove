import { optionalFileMutationBoolean } from './filesystemNormalize'
import { createAppError } from '../../../errors/appError'
import type {
  CopyEntryInMountInput,
  CreateDirectoryInMountInput,
  DeleteEntryInMountInput,
  MoveEntryInMountInput,
  RenameEntryInMountInput,
} from '../../dto'
import {
  isRecord,
  normalizeFileSystemUri,
  normalizeMountId,
  normalizeSourceTargetPayload,
} from './migrationMountNormalize'

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
