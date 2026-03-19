import { clipboard, ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../../shared/contracts/ipc'
import type { WriteClipboardTextInput } from '../../../../shared/contracts/dto'
import type { IpcRegistrationDisposable } from '../../../../app/main/ipc/types'
import { registerHandledIpc } from '../../../../app/main/ipc/handle'
import { normalizeWriteClipboardTextPayload } from './validate'

export function registerClipboardIpcHandlers(): IpcRegistrationDisposable {
  registerHandledIpc(
    IPC_CHANNELS.clipboardReadText,
    async (): Promise<string> => clipboard.readText(),
    { defaultErrorCode: 'common.unexpected' },
  )

  registerHandledIpc(
    IPC_CHANNELS.clipboardWriteText,
    async (_event, payload: WriteClipboardTextInput): Promise<void> => {
      const normalized = normalizeWriteClipboardTextPayload(payload)
      clipboard.writeText(normalized.text)
    },
    { defaultErrorCode: 'common.unexpected' },
  )

  return {
    dispose: () => {
      ipcMain.removeHandler(IPC_CHANNELS.clipboardReadText)
      ipcMain.removeHandler(IPC_CHANNELS.clipboardWriteText)
    },
  }
}
