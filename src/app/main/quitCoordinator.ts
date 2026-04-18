import { app, BrowserWindow } from 'electron'
import { requestRendererPersistFlush } from './rendererPersistFlush'

const DEFAULT_RENDERER_PERSIST_FLUSH_TIMEOUT_MS = 1_500

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
