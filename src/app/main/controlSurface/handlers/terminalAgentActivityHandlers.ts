import type { ListTerminalAgentActivityMetadataResult } from '../../../../shared/contracts/dto'
import { createAppError } from '../../../../shared/errors/appError'
import type { ControlSurface } from '../controlSurface'
import type { PtyStreamHub } from '../ptyStream/ptyStreamHub'

function normalizeEmptyPayload(payload: unknown): null {
  if (payload !== null && payload !== undefined) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'session.terminalAgentActivity.list does not accept a payload.',
    })
  }
  return null
}

export function registerTerminalAgentActivityHandlers(
  controlSurface: ControlSurface,
  deps: { ptyStreamHub: PtyStreamHub },
): void {
  controlSurface.register('session.terminalAgentActivity.list', {
    kind: 'query',
    validate: normalizeEmptyPayload,
    handle: (): ListTerminalAgentActivityMetadataResult =>
      deps.ptyStreamHub.listTerminalAgentActivityMetadata(),
    defaultErrorCode: 'common.unexpected',
  })
}
