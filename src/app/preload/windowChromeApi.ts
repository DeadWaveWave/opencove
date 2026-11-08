import { ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../../shared/contracts/ipc'
import type {
  SetWindowChromeThemeInput,
  WindowFocusState,
  WindowFullScreenState,
} from '../../shared/contracts/dto'
import { invokeIpc } from './ipcInvoke'

type UnsubscribeFn = () => void

export function createWindowChromePreloadApi(): {
  setTheme: (payload: SetWindowChromeThemeInput) => Promise<void>
  getFullScreen: () => Promise<WindowFullScreenState>
  onFullScreenChange: (listener: (state: WindowFullScreenState) => void) => UnsubscribeFn
  getFocus: () => Promise<WindowFocusState>
  onFocusChange: (listener: (state: WindowFocusState) => void) => UnsubscribeFn
} {
  return {
    setTheme: payload => invokeIpc(IPC_CHANNELS.windowChromeSetTheme, payload),
    getFullScreen: () => invokeIpc(IPC_CHANNELS.windowChromeGetFullScreen),
    onFullScreenChange: listener => {
      const handler = (_event: Electron.IpcRendererEvent, payload: WindowFullScreenState) => {
        listener(payload)
      }

      ipcRenderer.on(IPC_CHANNELS.windowChromeFullScreenChanged, handler)

      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.windowChromeFullScreenChanged, handler)
      }
    },
    getFocus: () => invokeIpc(IPC_CHANNELS.windowChromeGetFocus),
    onFocusChange: listener => {
      const handler = (_event: Electron.IpcRendererEvent, payload: WindowFocusState) => {
        if (typeof payload?.isFocused === 'boolean') {
          listener({ isFocused: payload.isFocused })
        }
      }

      ipcRenderer.on(IPC_CHANNELS.windowChromeFocusChanged, handler)

      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.windowChromeFocusChanged, handler)
      }
    },
  }
}
