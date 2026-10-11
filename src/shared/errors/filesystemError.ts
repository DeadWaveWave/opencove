import { APP_ERROR_CODES, type AppErrorDescriptor } from '../contracts/dto/error'

const REASONS = {
  not_found: 'The file or folder does not exist.',
  already_exists: 'The destination already exists.',
  permission_denied: 'Permission denied.',
  not_empty: 'The directory is not empty.',
  not_directory: 'A path component is not a directory.',
  is_directory: 'The path is a directory, not a file.',
} as const

export type FileSystemErrorReason = keyof typeof REASONS

export function fileSystemErrorReasonMessage(reason: unknown): string | undefined {
  return typeof reason === 'string' && Object.hasOwn(REASONS, reason)
    ? REASONS[reason as FileSystemErrorReason]
    : undefined
}

/** Public file failures contain stable codes/reasons, never provider paths or debug payloads. */
export function publicFileSystemError(error: unknown): AppErrorDescriptor | undefined {
  if (!error || typeof error !== 'object') {
    return undefined
  }
  const { code, params } = error as { code?: unknown; params?: Record<string, unknown> }
  if (
    typeof code !== 'string' ||
    !code.startsWith('filesystem.') ||
    !APP_ERROR_CODES.includes(code as AppErrorDescriptor['code'])
  ) {
    return undefined
  }
  const reason = params?.reason
  return {
    code: code as AppErrorDescriptor['code'],
    ...(fileSystemErrorReasonMessage(reason) ? { params: { reason: reason as string } } : {}),
  }
}
