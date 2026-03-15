import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../../shared/contracts/ipc'
import type { PersistWriteResult, ReadAppStateResult } from '../../../../shared/contracts/dto'
import type { IpcRegistrationDisposable } from '../../../../app/main/ipc/types'
import type { PersistenceStore } from '../PersistenceStore'
import {
  PayloadTooLargeError,
  normalizeReadNodeScrollbackPayload,
  normalizeWriteAppStatePayload,
  normalizeWriteNodeScrollbackPayload,
  normalizeWriteWorkspaceStateRawPayload,
} from './validate'

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`
  }

  return typeof error === 'string' ? error : 'Unknown error'
}

export function registerPersistenceIpcHandlers(
  getStore: () => Promise<PersistenceStore>,
  options: { maxRawBytes?: number } = {},
): IpcRegistrationDisposable {
  ipcMain.handle(
    IPC_CHANNELS.persistenceReadWorkspaceStateRaw,
    async (): Promise<string | null> => {
      try {
        const store = await getStore()
        return await store.readWorkspaceStateRaw()
      } catch {
        return null
      }
    },
  )

  ipcMain.handle(
    IPC_CHANNELS.persistenceWriteWorkspaceStateRaw,
    async (_event, payload: unknown): Promise<PersistWriteResult> => {
      let normalized: { raw: string }

      try {
        normalized = normalizeWriteWorkspaceStateRawPayload(payload, options)
      } catch (error) {
        return {
          ok: false,
          reason: error instanceof PayloadTooLargeError ? 'payload_too_large' : 'unknown',
          message: toErrorMessage(error),
        }
      }

      try {
        const store = await getStore()
        return await store.writeWorkspaceStateRaw(normalized.raw)
      } catch (error) {
        return { ok: false, reason: 'io', message: toErrorMessage(error) }
      }
    },
  )

  ipcMain.handle(IPC_CHANNELS.persistenceReadAppState, async (): Promise<ReadAppStateResult> => {
    try {
      const store = await getStore()
      const state = await store.readAppState()
      const recovery = store.consumeRecovery()
      return { state, recovery }
    } catch {
      return { state: null, recovery: null }
    }
  })

  ipcMain.handle(
    IPC_CHANNELS.persistenceWriteAppState,
    async (_event, payload: unknown): Promise<PersistWriteResult> => {
      let normalized: { state: unknown }

      try {
        normalized = normalizeWriteAppStatePayload(payload)
      } catch (error) {
        return { ok: false, reason: 'unknown', message: toErrorMessage(error) }
      }

      try {
        const store = await getStore()
        return await store.writeAppState(normalized.state)
      } catch (error) {
        return { ok: false, reason: 'io', message: toErrorMessage(error) }
      }
    },
  )

  ipcMain.handle(
    IPC_CHANNELS.persistenceReadNodeScrollback,
    async (_event, payload: unknown): Promise<string | null> => {
      let normalized: { nodeId: string }

      try {
        normalized = normalizeReadNodeScrollbackPayload(payload)
      } catch {
        return null
      }

      try {
        const store = await getStore()
        return await store.readNodeScrollback(normalized.nodeId)
      } catch {
        return null
      }
    },
  )

  ipcMain.handle(
    IPC_CHANNELS.persistenceWriteNodeScrollback,
    async (_event, payload: unknown): Promise<PersistWriteResult> => {
      let normalized: { nodeId: string; scrollback: string | null }

      try {
        normalized = normalizeWriteNodeScrollbackPayload(payload)
      } catch (error) {
        return { ok: false, reason: 'unknown', message: toErrorMessage(error) }
      }

      try {
        const store = await getStore()
        return await store.writeNodeScrollback(normalized.nodeId, normalized.scrollback)
      } catch (error) {
        return { ok: false, reason: 'io', message: toErrorMessage(error) }
      }
    },
  )

  return {
    dispose: () => {
      ipcMain.removeHandler(IPC_CHANNELS.persistenceReadWorkspaceStateRaw)
      ipcMain.removeHandler(IPC_CHANNELS.persistenceWriteWorkspaceStateRaw)
      ipcMain.removeHandler(IPC_CHANNELS.persistenceReadAppState)
      ipcMain.removeHandler(IPC_CHANNELS.persistenceWriteAppState)
      ipcMain.removeHandler(IPC_CHANNELS.persistenceReadNodeScrollback)
      ipcMain.removeHandler(IPC_CHANNELS.persistenceWriteNodeScrollback)
    },
  }
}
