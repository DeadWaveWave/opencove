import { createAppError } from './appError'

/** Only for known plugin failure results; ordinary/internal errors retain their own policy. */
export function createPluginOperationError(reason: string | undefined, fallback?: string) {
  return createAppError('plugin.operation_failed', {
    debugMessage: (reason?.trim() ? reason : fallback)?.slice(0, 2000),
  })
}
