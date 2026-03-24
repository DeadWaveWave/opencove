import { BrowserWindow, ipcMain, screen } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { IPC_CHANNELS } from '../../../shared/contracts/ipc'
import type { WindowDisplayInfo } from '../../../shared/contracts/dto'
import type { IpcRegistrationDisposable } from './types'
import { registerHandledIpc } from './handle'

function resolveWindowDisplayInfo(event: IpcMainInvokeEvent): WindowDisplayInfo {
  const targetWindow = BrowserWindow.fromWebContents(event.sender)
  if (!targetWindow || targetWindow.isDestroyed()) {
    throw new Error('Unable to resolve BrowserWindow for display metrics request')
  }

  const contentBounds = targetWindow.getContentBounds()
  const display = screen.getDisplayMatching(contentBounds)
  const displayScaleFactor =
    typeof display.scaleFactor === 'number' && Number.isFinite(display.scaleFactor)
      ? display.scaleFactor
      : 1

  return {
    contentWidthDip: Math.round(contentBounds.width),
    contentHeightDip: Math.round(contentBounds.height),
    displayScaleFactor,
    effectiveWidthPx: Math.round(contentBounds.width * displayScaleFactor),
    effectiveHeightPx: Math.round(contentBounds.height * displayScaleFactor),
  }
}

export function registerWindowMetricsIpcHandlers(): IpcRegistrationDisposable {
  registerHandledIpc(
    IPC_CHANNELS.windowMetricsGetDisplayInfo,
    (event: IpcMainInvokeEvent): WindowDisplayInfo => resolveWindowDisplayInfo(event),
    { defaultErrorCode: 'common.unexpected' },
  )

  return {
    dispose: () => {
      ipcMain.removeHandler(IPC_CHANNELS.windowMetricsGetDisplayInfo)
    },
  }
}
