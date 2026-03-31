import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../shared/contracts/ipc'
import type { IpcRegistrationDisposable } from './types'
import { registerHandledIpc } from './handle'
import {
  getLocalWorkerStatus,
  getLocalWorkerWebUiUrl,
  startLocalWorker,
  stopLocalWorker,
} from '../worker/localWorkerManager'

export function registerLocalWorkerIpcHandlers(): IpcRegistrationDisposable {
  registerHandledIpc(IPC_CHANNELS.workerGetStatus, async () => await getLocalWorkerStatus(), {
    defaultErrorCode: 'common.unexpected',
  })

  registerHandledIpc(IPC_CHANNELS.workerStart, async () => await startLocalWorker(), {
    defaultErrorCode: 'common.unexpected',
  })

  registerHandledIpc(IPC_CHANNELS.workerStop, async () => await stopLocalWorker(), {
    defaultErrorCode: 'common.unexpected',
  })

  registerHandledIpc(IPC_CHANNELS.workerGetWebUiUrl, async () => await getLocalWorkerWebUiUrl(), {
    defaultErrorCode: 'common.unexpected',
  })

  return {
    dispose: () => {
      ipcMain.removeHandler(IPC_CHANNELS.workerGetStatus)
      ipcMain.removeHandler(IPC_CHANNELS.workerStart)
      ipcMain.removeHandler(IPC_CHANNELS.workerStop)
      ipcMain.removeHandler(IPC_CHANNELS.workerGetWebUiUrl)
    },
  }
}
