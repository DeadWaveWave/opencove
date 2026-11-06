import type { ListTerminalAgentActivityMetadataResult } from '../../../../shared/contracts/dto'
import { registerOperation } from '../registerOperation'
import { sessionTerminalAgentActivityListOperation } from '@shared/contracts/controlSurface/operations/domains/session'
import type { ControlSurface } from '../controlSurface'
import type { PtyStreamHub } from '../ptyStream/ptyStreamHub'

export function registerTerminalAgentActivityHandlers(
  controlSurface: ControlSurface,
  deps: { ptyStreamHub: PtyStreamHub },
): void {
  registerOperation(controlSurface, sessionTerminalAgentActivityListOperation, {
    handle: (): ListTerminalAgentActivityMetadataResult =>
      deps.ptyStreamHub.listTerminalAgentActivityMetadata(),
    defaultErrorCode: 'common.unexpected',
  })
}
