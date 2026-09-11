import { ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../../shared/contracts/ipc'
import {
  isApplicationShortcutEvent,
  type ApplicationShortcutEvent,
} from '../../shared/contracts/applicationShortcut'

export function onApplicationShortcut(
  listener: (event: ApplicationShortcutEvent) => void,
): () => void {
  const handler = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
    if (isApplicationShortcutEvent(payload)) {
      listener(payload)
    }
  }
  ipcRenderer.on(IPC_CHANNELS.appShortcut, handler)
  return () => ipcRenderer.removeListener(IPC_CHANNELS.appShortcut, handler)
}
