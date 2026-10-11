import type { AppErrorCode } from '../../../shared/contracts/dto'
import {
  createAppError,
  isAppErrorDescriptor,
  toAppErrorDescriptor,
} from '../../../shared/errors/appError'
import type { FileSystemErrorReason } from '../../../shared/errors/filesystemError'

const SYSTEM_REASONS: Record<string, FileSystemErrorReason> = {
  ENOENT: 'not_found',
  EEXIST: 'already_exists',
  ERR_FS_CP_EEXIST: 'already_exists',
  EACCES: 'permission_denied',
  EPERM: 'permission_denied',
  ENOTEMPTY: 'not_empty',
  ENOTDIR: 'not_directory',
  EISDIR: 'is_directory',
  ERR_FS_EISDIR: 'is_directory',
}

/** Normalize at the provider/application boundary before local or remote envelopes erase errno. */
export async function fileSystemOperation<T>(
  code: AppErrorCode,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    if (isAppErrorDescriptor(error)) {
      throw error
    }
    const systemCode =
      error && typeof error === 'object' && 'code' in error ? error.code : undefined
    const reason =
      typeof systemCode === 'string' && Object.hasOwn(SYSTEM_REASONS, systemCode)
        ? SYSTEM_REASONS[systemCode]
        : undefined
    if (reason) {
      throw createAppError(code, { params: { reason } })
    }
    throw createAppError(toAppErrorDescriptor(error, code))
  }
}
