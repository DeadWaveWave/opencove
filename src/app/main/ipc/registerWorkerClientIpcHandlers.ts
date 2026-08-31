import { app, ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../shared/contracts/ipc'
import type {
  SetHomeWorkerConfigInput,
  SetHomeWorkerWebUiSecurityInput,
  SetHomeWorkerWebUiSettingsInput,
} from '../../../shared/contracts/dto'
import type { IpcRegistrationDisposable } from './types'
import { registerHandledIpc } from './handle'
import { createHomeWorkerConfigurationRouter } from '../worker/homeWorkerConfigurationRouter'

export function registerWorkerClientIpcHandlers(): IpcRegistrationDisposable {
  const router = createHomeWorkerConfigurationRouter({
    userDataPath: app.getPath('userData'),
    configOptions: {
      allowStandaloneMode: false,
      allowRemoteMode: app.isPackaged === false,
    },
    ensureMissingConfig: app.isPackaged,
  })

  registerHandledIpc(IPC_CHANNELS.workerClientGetConfig, router.read, {
    defaultErrorCode: 'common.unexpected',
  })
  registerHandledIpc(
    IPC_CHANNELS.workerClientSetConfig,
    async (_event, payload: SetHomeWorkerConfigInput) => await router.setConfig(payload),
    { defaultErrorCode: 'common.unexpected' },
  )
  registerHandledIpc(
    IPC_CHANNELS.workerClientSetWebUiSettings,
    async (_event, payload: SetHomeWorkerWebUiSettingsInput) =>
      await router.setWebUiSettings(payload),
    { defaultErrorCode: 'common.unexpected' },
  )
  registerHandledIpc(
    IPC_CHANNELS.workerClientSetWebUiSecurity,
    async (_event, payload: SetHomeWorkerWebUiSecurityInput) =>
      await router.setWebUiSecurity(payload),
    { defaultErrorCode: 'common.unexpected' },
  )
  registerHandledIpc(
    IPC_CHANNELS.workerClientRelaunch,
    async () => {
      if (process.env.NODE_ENV === 'test') {
        return
      }
      app.relaunch()
      app.exit(0)
    },
    { defaultErrorCode: 'common.unexpected' },
  )

  return {
    dispose: () => {
      ipcMain.removeHandler(IPC_CHANNELS.workerClientGetConfig)
      ipcMain.removeHandler(IPC_CHANNELS.workerClientSetConfig)
      ipcMain.removeHandler(IPC_CHANNELS.workerClientSetWebUiSettings)
      ipcMain.removeHandler(IPC_CHANNELS.workerClientSetWebUiSecurity)
      ipcMain.removeHandler(IPC_CHANNELS.workerClientRelaunch)
    },
  }
}
