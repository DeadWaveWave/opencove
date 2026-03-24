import { ipcMain } from 'electron'
import { registerHandledIpc } from '../../../../app/main/ipc/handle'
import type { IpcRegistrationDisposable } from '../../../../app/main/ipc/types'
import { IPC_CHANNELS } from '../../../../shared/contracts/ipc'
import type {
  GetCurrentReleaseNotesInput,
  ReleaseNotesCurrentResult,
} from '../../../../shared/contracts/dto'
import type { ReleaseNotesService } from '../../infrastructure/main/ReleaseNotesService'
import { normalizeGetCurrentReleaseNotesPayload } from './validate'

export function registerReleaseNotesIpcHandlers(
  service: ReleaseNotesService,
): IpcRegistrationDisposable {
  registerHandledIpc(
    IPC_CHANNELS.releaseNotesGetCurrent,
    async (_event, payload: GetCurrentReleaseNotesInput): Promise<ReleaseNotesCurrentResult> => {
      const normalized = normalizeGetCurrentReleaseNotesPayload(payload)
      return await service.getCurrent(normalized)
    },
    { defaultErrorCode: 'release_notes.get_current_failed' },
  )

  return {
    dispose: () => {
      ipcMain.removeHandler(IPC_CHANNELS.releaseNotesGetCurrent)
    },
  }
}
