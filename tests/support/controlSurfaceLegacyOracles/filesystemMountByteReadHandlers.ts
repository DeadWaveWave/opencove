// @compat-file control-surface-legacy-validation
// Frozen validator bodies from src/app/main/controlSurface/handlers/filesystemMountReadHandlers.ts at 6df96903c64d6fb3c541c79815713996d3c1b186; imports relocated only.
import { createAppError } from '../../../src/shared/errors/appError'
import type { ReadFileBytesInMountInput } from '../../../src/shared/contracts/dto'
import { isRecord, normalizeFileSystemUri, normalizeMountId } from './filesystemMountSupport'

export const normalizeFilesystemReadFileBytesInMount = (
  payload: unknown,
): ReadFileBytesInMountInput => {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for filesystem.readFileBytesInMount.',
    })
  }

  return {
    mountId: normalizeMountId(payload.mountId, 'filesystem.readFileBytesInMount'),
    uri: normalizeFileSystemUri(payload.uri, 'filesystem.readFileBytesInMount'),
  }
}
