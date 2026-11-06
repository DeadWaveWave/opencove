import type { AppErrorDescriptor } from '../../../../shared/contracts/dto'

export function isUnknownControlSurfaceOperationError(
  error: AppErrorDescriptor | null | undefined,
  operationId: string,
): boolean {
  if (!error) {
    return false
  }

  if (error.code !== 'common.invalid_input') {
    return false
  }

  const debugMessage = typeof error.debugMessage === 'string' ? error.debugMessage : ''
  return debugMessage.includes('Unknown control surface') && debugMessage.includes(operationId)
}
