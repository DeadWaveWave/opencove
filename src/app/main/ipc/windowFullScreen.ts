import type { BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '../../../shared/contracts/ipc'
import type { WindowFullScreenState } from '../../../shared/contracts/dto'

/**
 * Tells the window's renderer when it enters or leaves native full screen, so the header can take
 * back the room macOS keeps for the traffic lights. The listeners live as long as the window.
 */
export function broadcastWindowFullScreen(window: BrowserWindow): void {
  const send = (isFullScreen: boolean) => () => {
    if (window.isDestroyed() || window.webContents.isDestroyed()) {
      return
    }

    const state: WindowFullScreenState = { isFullScreen }
    window.webContents.send(IPC_CHANNELS.windowChromeFullScreenChanged, state)
  }

  window.on('enter-full-screen', send(true))
  window.on('leave-full-screen', send(false))
}
