import {
  formatAppErrorMessage,
  isAppErrorDescriptor,
  OpenCoveAppError,
} from '@shared/errors/appError'

/** The producer and transport boundary own privacy; plugin author diagnostics remain visible. */
export function pluginErrorMessage(error: unknown): string {
  const descriptor =
    error instanceof OpenCoveAppError
      ? error.toDescriptor()
      : isAppErrorDescriptor(error)
        ? error
        : undefined
  if (
    descriptor?.code === 'plugin.operation_failed' &&
    typeof descriptor.debugMessage === 'string' &&
    descriptor.debugMessage.trim()
  ) {
    return descriptor.debugMessage.slice(0, 2000)
  }
  return formatAppErrorMessage(descriptor ?? { code: 'plugin.operation_failed' })
}
