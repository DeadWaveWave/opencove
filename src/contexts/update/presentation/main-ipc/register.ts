import { ipcMain } from 'electron'
import { registerHandledIpc } from '../../../../app/main/ipc/handle'
import type { IpcRegistrationDisposable } from '../../../../app/main/ipc/types'
import { IPC_CHANNELS } from '../../../../shared/contracts/ipc'
import type { AppUpdateState, ConfigureAppUpdatesInput } from '../../../../shared/contracts/dto'
import type { AppUpdateService } from '../../infrastructure/main/AppUpdateService'
import { normalizeConfigureAppUpdatesPayload } from './validate'

export function registerAppUpdateIpcHandlers(
  updateService: AppUpdateService,
): IpcRegistrationDisposable {
  registerHandledIpc(
    IPC_CHANNELS.appUpdateGetState,
    (): AppUpdateState => updateService.getState(),
    {
      defaultErrorCode: 'update.get_state_failed',
    },
  )

  registerHandledIpc(
    IPC_CHANNELS.appUpdateConfigure,
    async (_event, payload: ConfigureAppUpdatesInput): Promise<AppUpdateState> => {
      const normalized = normalizeConfigureAppUpdatesPayload(payload)
      return await updateService.configure(normalized)
    },
    { defaultErrorCode: 'update.configure_failed' },
  )

  registerHandledIpc(
    IPC_CHANNELS.appUpdateCheck,
    async (): Promise<AppUpdateState> => {
      return await updateService.checkForUpdates()
    },
    {
      defaultErrorCode: 'update.check_failed',
    },
  )

  registerHandledIpc(
    IPC_CHANNELS.appUpdateDownload,
    async (): Promise<AppUpdateState> => {
      return await updateService.downloadUpdate()
    },
    {
      defaultErrorCode: 'update.download_failed',
    },
  )

  registerHandledIpc(
    IPC_CHANNELS.appUpdateInstall,
    async (): Promise<void> => {
      await updateService.installUpdate()
    },
    {
      defaultErrorCode: 'update.install_failed',
    },
  )

  return {
    dispose: () => {
      ipcMain.removeHandler(IPC_CHANNELS.appUpdateGetState)
      ipcMain.removeHandler(IPC_CHANNELS.appUpdateConfigure)
      ipcMain.removeHandler(IPC_CHANNELS.appUpdateCheck)
      ipcMain.removeHandler(IPC_CHANNELS.appUpdateDownload)
      ipcMain.removeHandler(IPC_CHANNELS.appUpdateInstall)
      updateService.dispose()
    },
  }
}
