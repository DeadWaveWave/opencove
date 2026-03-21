import { ipcMain } from 'electron'
import { registerHandledIpc } from '../../../../app/main/ipc/handle'
import type { IpcRegistrationDisposable } from '../../../../app/main/ipc/types'
import { IPC_CHANNELS } from '../../../../shared/contracts/ipc'
import type {
  GetReleaseNotesAutoRangeInput,
  GetReleaseNotesRangeInput,
  ReleaseNotesRangeResult,
} from '../../../../shared/contracts/dto'
import type { ReleaseNotesService } from '../../infrastructure/main/ReleaseNotesService'
import {
  normalizeGetReleaseNotesAutoRangePayload,
  normalizeGetReleaseNotesRangePayload,
} from './validate'

export function registerReleaseNotesIpcHandlers(
  service: ReleaseNotesService,
): IpcRegistrationDisposable {
  registerHandledIpc(
    IPC_CHANNELS.releaseNotesGetRange,
    async (_event, payload: GetReleaseNotesRangeInput): Promise<ReleaseNotesRangeResult> => {
      const normalized = normalizeGetReleaseNotesRangePayload(payload)
      return await service.getRange(normalized)
    },
    { defaultErrorCode: 'release_notes.get_range_failed' },
  )

  registerHandledIpc(
    IPC_CHANNELS.releaseNotesGetAutoRange,
    async (_event, payload: GetReleaseNotesAutoRangeInput): Promise<ReleaseNotesRangeResult> => {
      const normalized = normalizeGetReleaseNotesAutoRangePayload(payload)
      return await service.getAutoRange(normalized)
    },
    { defaultErrorCode: 'release_notes.get_range_failed' },
  )

  return {
    dispose: () => {
      ipcMain.removeHandler(IPC_CHANNELS.releaseNotesGetRange)
      ipcMain.removeHandler(IPC_CHANNELS.releaseNotesGetAutoRange)
    },
  }
}
