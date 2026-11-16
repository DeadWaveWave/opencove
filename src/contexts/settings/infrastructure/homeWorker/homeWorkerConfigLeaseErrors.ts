export type LeaseOperation = 'claim' | 'reclaim' | 'restore' | 'release'

// held: another owner has the lease. ambiguous: the code cannot tell a held lease from a transient
// handle, so the caller looks at the lease. absent: the thing the operation moves is already gone.
export type LeaseFsErrorClass = 'held' | 'ambiguous' | 'absent' | 'fatal'

const POSIX_HELD_CODES = new Set(['EEXIST', 'ENOTEMPTY', 'ENOTDIR', 'EISDIR'])
// On Windows a rename onto an existing directory, or away from one that another process has a file
// open in, reports EPERM rather than EEXIST; a scanner or indexer can produce the same codes. On
// POSIX these codes mean permissions and stay fatal.
const WINDOWS_AMBIGUOUS_CODES = new Set(['EPERM', 'EACCES', 'EBUSY'])

export function readFsErrorCode(error: unknown): string | null {
  const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : null
  return typeof code === 'string' ? code : null
}

function isAmbiguous(code: string | null, platform: NodeJS.Platform): boolean {
  return platform === 'win32' && code !== null && WINDOWS_AMBIGUOUS_CODES.has(code)
}

/** The only place that decides what a filesystem error code means for a lease operation. */
export function classifyLeaseFsError(
  operation: LeaseOperation,
  code: string | null,
  platform: NodeJS.Platform = process.platform,
): LeaseFsErrorClass {
  switch (operation) {
    case 'claim':
      if (code !== null && POSIX_HELD_CODES.has(code)) {
        return 'held'
      }
      return isAmbiguous(code, platform) ? 'ambiguous' : 'fatal'
    case 'reclaim':
    case 'release':
      if (code === 'ENOENT') {
        return 'absent'
      }
      return isAmbiguous(code, platform) ? 'ambiguous' : 'fatal'
    case 'restore':
      return isAmbiguous(code, platform) ? 'ambiguous' : 'fatal'
    default: {
      const unhandled: never = operation
      throw new Error(`Unhandled lease operation: ${String(unhandled)}`)
    }
  }
}
