import { createAppError, isIpcInvokeResult } from '../../../src/shared/errors/appError'

export async function invokeHandledIpc<TResult>(
  handler: ((...args: unknown[]) => unknown) | undefined,
  ...args: unknown[]
): Promise<TResult> {
  const result = await handler?.(...args)

  if (isIpcInvokeResult<TResult>(result)) {
    if (result.ok) {
      return result.value
    }

    throw createAppError(result.error)
  }

  return result as TResult
}
