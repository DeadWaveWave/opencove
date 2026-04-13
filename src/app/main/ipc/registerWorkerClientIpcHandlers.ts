import { app, ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../shared/contracts/ipc'
import type {
  SetHomeWorkerConfigInput,
  SetHomeWorkerWebUiSecurityInput,
  SetHomeWorkerWebUiSettingsInput,
} from '../../../shared/contracts/dto'
import type { IpcRegistrationDisposable } from './types'
import { registerHandledIpc } from './handle'
import {
  ensureHomeWorkerConfig,
  readHomeWorkerConfig,
  setHomeWorkerConfig,
  setHomeWorkerWebUiSecurity,
  setHomeWorkerWebUiSettings,
} from '../worker/homeWorkerConfig'

export function registerWorkerClientIpcHandlers(): IpcRegistrationDisposable {
  const configOptions = {
    allowStandaloneMode: app.isPackaged === false,
    allowRemoteMode: app.isPackaged === false,
  }

  registerHandledIpc(
    IPC_CHANNELS.workerClientGetConfig,
    async () =>
      app.isPackaged
        ? await ensureHomeWorkerConfig(app.getPath('userData'), configOptions)
        : await readHomeWorkerConfig(app.getPath('userData'), configOptions),
    { defaultErrorCode: 'common.unexpected' },
  )

  registerHandledIpc(
    IPC_CHANNELS.workerClientSetConfig,
    async (_event, payload: SetHomeWorkerConfigInput) =>
      await setHomeWorkerConfig(app.getPath('userData'), payload, configOptions),
    { defaultErrorCode: 'common.unexpected' },
  )

  registerHandledIpc(
    IPC_CHANNELS.workerClientSetWebUiSettings,
    async (_event, payload: SetHomeWorkerWebUiSettingsInput) =>
      await setHomeWorkerWebUiSettings(app.getPath('userData'), payload, configOptions),
    { defaultErrorCode: 'common.unexpected' },
  )

  registerHandledIpc(
    IPC_CHANNELS.workerClientSetWebUiSecurity,
    async (_event, payload: SetHomeWorkerWebUiSecurityInput) =>
      await setHomeWorkerWebUiSecurity(app.getPath('userData'), payload, configOptions),
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
