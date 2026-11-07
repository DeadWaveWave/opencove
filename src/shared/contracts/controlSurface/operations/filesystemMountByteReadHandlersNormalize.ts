import { createAppError } from '../../../errors/appError'
import type { ReadFileBytesInMountInput } from '../../dto'
import { isRecord, normalizeFileSystemUri, normalizeMountId } from './filesystemMountPayloadSupport'

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
