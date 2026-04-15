import { ipcMain } from 'electron'
import type { IpcMainEvent, WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import { IPC_CHANNELS } from '../../shared/contracts/ipc'

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

export async function requestRendererPersistFlush(
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
