import type { BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '../../../shared/contracts/ipc'
import type { WindowFocusState } from '../../../shared/contracts/dto'

/**
 * Tells the window's renderer when it gains or loses focus, so a countdown can wait while
 * OpenCove is behind another app. The renderer's own focus signals cannot tell (see
 * docs/agent/ATTENTION.md). The listeners live as long as the window.
 */
export function broadcastWindowFocus(window: BrowserWindow): void {
  const send = (isFocused: boolean) => () => {
    if (window.isDestroyed() || window.webContents.isDestroyed()) {
      return
    }

    const state: WindowFocusState = { isFocused }
    window.webContents.send(IPC_CHANNELS.windowChromeFocusChanged, state)
  }

  window.on('focus', send(true))
  window.on('blur', send(false))
}
