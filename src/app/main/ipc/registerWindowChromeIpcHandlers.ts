import { BrowserWindow, ipcMain } from 'electron'
import type { IpcMainInvokeEvent, TitleBarOverlay } from 'electron'
import { IPC_CHANNELS } from '../../../shared/contracts/ipc'
import type {
  SetWindowChromeThemeInput,
  WindowFullScreenState,
} from '../../../shared/contracts/dto'
import type { IpcRegistrationDisposable } from './types'
import { registerHandledIpc } from './handle'

const WINDOW_CHROME_HEIGHT_PX = 36

function resolveTitleBarOverlay(theme: SetWindowChromeThemeInput['theme']): TitleBarOverlay {
  return {
    color: '#00000000',
    symbolColor: theme === 'light' ? '#475569' : '#dbeafe',
    height: WINDOW_CHROME_HEIGHT_PX,
  }
}

function normalizeSetWindowChromeThemeInput(
  payload: SetWindowChromeThemeInput,
): SetWindowChromeThemeInput {
  if (!payload || (payload.theme !== 'light' && payload.theme !== 'dark')) {
    throw new Error('Invalid window chrome theme payload')
  }

  return payload
}

export function registerWindowChromeIpcHandlers(): IpcRegistrationDisposable {
  registerHandledIpc(
    IPC_CHANNELS.windowChromeSetTheme,
    (event: IpcMainInvokeEvent, payload: SetWindowChromeThemeInput) => {
      const normalized = normalizeSetWindowChromeThemeInput(payload)
      const targetWindow = BrowserWindow.fromWebContents(event.sender)

      if (!targetWindow || targetWindow.isDestroyed() || process.platform !== 'win32') {
        return
      }

      targetWindow.setTitleBarOverlay(resolveTitleBarOverlay(normalized.theme))
    },
    { defaultErrorCode: 'common.unexpected' },
  )

  registerHandledIpc(
    IPC_CHANNELS.windowChromeGetFullScreen,
    (event: IpcMainInvokeEvent): WindowFullScreenState => {
      const targetWindow = BrowserWindow.fromWebContents(event.sender)
      return {
        isFullScreen: Boolean(
          targetWindow && !targetWindow.isDestroyed() && targetWindow.isFullScreen(),
        ),
      }
    },
    { defaultErrorCode: 'common.unexpected' },
  )

  return {
    dispose: () => {
      ipcMain.removeHandler(IPC_CHANNELS.windowChromeSetTheme)
      ipcMain.removeHandler(IPC_CHANNELS.windowChromeGetFullScreen)
    },
  }
}

export { WINDOW_CHROME_HEIGHT_PX, resolveTitleBarOverlay }
