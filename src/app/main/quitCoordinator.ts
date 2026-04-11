import { app, BrowserWindow, ipcMain } from 'electron'
import type { IpcMainEvent, WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import { IPC_CHANNELS } from '../../shared/contracts/ipc'

const DEFAULT_RENDERER_PERSIST_FLUSH_TIMEOUT_MS = 1_500

function normalizeQuitFlushCompletePayload(payload: unknown): { requestId: string } | null {
  if (!payload || typeof payload !== 'object') {
    return null
  }

  const requestId = (payload as { requestId?: unknown }).requestId
  if (typeof requestId !== 'string') {
    return null
  }

  const normalized = requestId.trim()
  return normalized.length > 0 ? { requestId: normalized } : null
}

async function requestRendererPersistFlush(
  webContents: WebContents,
  timeoutMs: number,
): Promise<void> {
  if (webContents.isDestroyed()) {
    return
  }

  const requestId = randomUUID()

  await new Promise<void>(resolve => {
    let settled = false

    const settle = () => {
      if (settled) {
        return
      }

      settled = true
      clearTimeout(timeoutHandle)
      ipcMain.removeListener(IPC_CHANNELS.appPersistFlushComplete, handleFlushComplete)
      resolve()
    }

    const timeoutHandle = setTimeout(settle, timeoutMs)

    const handleFlushComplete = (event: IpcMainEvent, payload: unknown) => {
      if (event.sender.id !== webContents.id) {
        return
      }

      const normalized = normalizeQuitFlushCompletePayload(payload)
      if (!normalized || normalized.requestId !== requestId) {
        return
      }

      settle()
    }

    ipcMain.on(IPC_CHANNELS.appPersistFlushComplete, handleFlushComplete)

    try {
      webContents.send(IPC_CHANNELS.appRequestPersistFlush, { requestId })
    } catch {
      settle()
    }
  })
}

async function flushRenderersBeforeQuit(timeoutMs: number): Promise<void> {
  const windows = BrowserWindow.getAllWindows()
  if (windows.length === 0) {
    return
  }

  await Promise.allSettled(
    windows.map(async window => {
      if (window.isDestroyed()) {
        return
      }

      await requestRendererPersistFlush(window.webContents, timeoutMs)
    }),
  )
}

let hasRegisteredQuitCoordinator = false

export function registerQuitCoordinator(options: {
  rendererPersistFlushTimeoutMs?: number
  hasOwnedLocalWorkerProcess: () => boolean
  stopOwnedLocalWorker: () => Promise<unknown>
}): void {
  if (hasRegisteredQuitCoordinator) {
    return
  }

  hasRegisteredQuitCoordinator = true

  let isCleaningUpOwnedLocalWorkerOnQuit = false
  let isCoordinatingQuit = false
  let allowQuit = false

  const rendererPersistFlushTimeoutMs =
    options.rendererPersistFlushTimeoutMs ?? DEFAULT_RENDERER_PERSIST_FLUSH_TIMEOUT_MS

  const signalHandler = () => {
    // Ensure `Ctrl+C` shutdowns in dev follow the same durable flush path as Cmd+Q.
    app.quit()
  }

  process.once('SIGINT', signalHandler)
  process.once('SIGTERM', signalHandler)

  app.on('before-quit', event => {
    if (allowQuit) {
      return
    }

    if (!event || typeof (event as { preventDefault?: unknown }).preventDefault !== 'function') {
      return
    }

    ;(event as { preventDefault: () => void }).preventDefault()

    if (isCoordinatingQuit) {
      return
    }

    isCoordinatingQuit = true

    void (async () => {
      await flushRenderersBeforeQuit(rendererPersistFlushTimeoutMs)

      if (!isCleaningUpOwnedLocalWorkerOnQuit && options.hasOwnedLocalWorkerProcess()) {
        isCleaningUpOwnedLocalWorkerOnQuit = true
        await options.stopOwnedLocalWorker().catch(() => undefined)
      }
    })()
      .catch(() => undefined)
      .finally(() => {
        allowQuit = true
        isCoordinatingQuit = false
        app.quit()
      })
  })
}
