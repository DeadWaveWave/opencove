import { ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../../shared/contracts/ipc'
import type {
  ListSystemFontsResult,
  SaveTextToDownloadsInput,
  SaveTextToDownloadsResult,
  ShowSystemNotificationInput,
  ShowSystemNotificationResult,
  SystemNotificationActivatedEvent,
} from '../../shared/contracts/dto'
import { invokeIpc } from './ipcInvoke'

type UnsubscribeFn = () => void

export function createSystemPreloadApi(): {
  listFonts: () => Promise<ListSystemFontsResult>
  saveTextToDownloads: (payload: SaveTextToDownloadsInput) => Promise<SaveTextToDownloadsResult>
  showNotification: (payload: ShowSystemNotificationInput) => Promise<ShowSystemNotificationResult>
  onNotificationActivated: (
    listener: (event: SystemNotificationActivatedEvent) => void,
  ) => UnsubscribeFn
} {
  return {
    listFonts: () => invokeIpc(IPC_CHANNELS.systemListFonts),
    saveTextToDownloads: payload => invokeIpc(IPC_CHANNELS.systemSaveTextToDownloads, payload),
    showNotification: payload => invokeIpc(IPC_CHANNELS.systemShowNotification, payload),
    onNotificationActivated: listener => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        payload: SystemNotificationActivatedEvent,
      ) => {
        listener(payload)
      }
      ipcRenderer.on(IPC_CHANNELS.systemNotificationActivated, handler)
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.systemNotificationActivated, handler)
      }
    },
  }
}
