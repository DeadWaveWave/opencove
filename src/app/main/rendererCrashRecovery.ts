import type { BrowserWindow } from 'electron'

export function scheduleRendererRecovery(window: BrowserWindow, canReload: () => boolean): void {
  // Electron 41 emits render-process-gone during Chromium process-death notification.
  // Re-entering renderer startup here trips RendererStartupHelper's CHECK. Wait for
  // the native observer stack to unwind (electron/electron#51900), then check ownership.
  setImmediate(() => {
    if (!window.isDestroyed() && !window.webContents.isDestroyed() && canReload()) {
      window.webContents.reload()
    }
  })
}
