import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../shared/contracts/ipc'
import type { CliPathStatusResult } from '../../../shared/contracts/dto'
import type { IpcRegistrationDisposable } from './types'
import { registerHandledIpc } from './handle'
import {
  installCliToPath,
  resolveCliPathStatus,
  uninstallCliFromPath,
} from '../cli/cliPathInstaller'

export function registerCliIpcHandlers(): IpcRegistrationDisposable {
  registerHandledIpc(
    IPC_CHANNELS.cliGetStatus,
    async (): Promise<CliPathStatusResult> => await resolveCliPathStatus(),
    { defaultErrorCode: 'common.unexpected' },
  )

  registerHandledIpc(
    IPC_CHANNELS.cliInstall,
    async (): Promise<CliPathStatusResult> => await installCliToPath(),
    { defaultErrorCode: 'common.unexpected' },
  )

  registerHandledIpc(
    IPC_CHANNELS.cliUninstall,
    async (): Promise<CliPathStatusResult> => await uninstallCliFromPath(),
    { defaultErrorCode: 'common.unexpected' },
  )

  return {
    dispose: () => {
      ipcMain.removeHandler(IPC_CHANNELS.cliGetStatus)
      ipcMain.removeHandler(IPC_CHANNELS.cliInstall)
      ipcMain.removeHandler(IPC_CHANNELS.cliUninstall)
    },
  }
}
