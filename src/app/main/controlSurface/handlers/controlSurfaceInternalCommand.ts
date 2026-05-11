import type { ControlSurface } from '../controlSurface'
import { createAppError } from '../../../../shared/errors/appError'

export async function invokeInternalCommand<TResult>(
  controlSurface: ControlSurface,
  ctx: Parameters<ControlSurface['invoke']>[0],
  request: { id: string; payload: unknown },
): Promise<TResult> {
  const result = await controlSurface.invoke(ctx, {
    kind: 'command',
    id: request.id,
    payload: request.payload,
  })

  if (result.ok === false) {
    throw createAppError(result.error)
  }

  return result.value as TResult
}
