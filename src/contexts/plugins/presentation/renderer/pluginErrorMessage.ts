import { formatAppErrorMessage } from '@shared/errors/appError'
import { toRendererAppErrorDescriptor } from '@shared/errors/rendererAppError'

/** Public plugin failures use catalog prose, never arbitrary diagnostic text. */
export function pluginErrorMessage(error: unknown): string {
  return formatAppErrorMessage(
    toRendererAppErrorDescriptor(error) ?? { code: 'plugin.operation_failed' },
  )
}
