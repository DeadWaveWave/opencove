import type { PersistWriteResult, ReadAppStateResult } from '@shared/contracts/dto'
import { createAppErrorDescriptor, toAppErrorDescriptor } from '@shared/errors/appError'
import { LEGACY_STORAGE_KEY, STORAGE_KEY } from './constants'
import { getStorage, isQuotaExceededError } from './storage'

export type PersistencePortKind = 'ipc' | 'localStorage'

export interface PersistencePort {
  kind: PersistencePortKind
  readAppState: () => Promise<ReadAppStateResult | null>
  writeAppState: (state: unknown) => Promise<PersistWriteResult>
  readNodeScrollback: (nodeId: string) => Promise<string | null>
  writeNodeScrollback: (nodeId: string, scrollback: string | null) => Promise<PersistWriteResult>
  readWorkspaceStateRaw: () => Promise<string | null>
  writeWorkspaceStateRaw: (raw: string) => Promise<PersistWriteResult>
}

const NODE_SCROLLBACK_KEY_PREFIX = 'opencove:m0:node-scrollback:'
const LEGACY_NODE_SCROLLBACK_KEY_PREFIX = 'cove:m0:node-scrollback:'
function createIpcPort(): PersistencePort | null {
  if (typeof window === 'undefined') {
    return null
  }

  const persistenceApi = window.opencoveApi?.persistence
  if (!persistenceApi) {
    return null
  }

  return {
    kind: 'ipc',
    readAppState: async () => {
      try {
        return await persistenceApi.readAppState()
      } catch {
        return null
      }
    },
    writeAppState: async state => {
      try {
        return await persistenceApi.writeAppState({ state })
      } catch (error) {
        return {
          ok: false,
          reason: 'io',
          error: createAppErrorDescriptor('persistence.io_failed', {
            debugMessage: toAppErrorDescriptor(error).debugMessage,
          }),
        }
      }
    },
    readNodeScrollback: async nodeId => {
      try {
        return await persistenceApi.readNodeScrollback({ nodeId })
      } catch {
        return null
      }
    },
    writeNodeScrollback: async (nodeId, scrollback) => {
      try {
        return await persistenceApi.writeNodeScrollback({ nodeId, scrollback })
      } catch (error) {
        return {
          ok: false,
          reason: 'io',
          error: createAppErrorDescriptor('persistence.io_failed', {
            debugMessage: toAppErrorDescriptor(error).debugMessage,
          }),
        }
      }
    },
    readWorkspaceStateRaw: async () => {
      try {
        return await persistenceApi.readWorkspaceStateRaw()
      } catch {
        return null
      }
    },
    writeWorkspaceStateRaw: async raw => {
      try {
        return await persistenceApi.writeWorkspaceStateRaw({ raw })
      } catch (error) {
        return {
          ok: false,
          reason: 'io',
          error: createAppErrorDescriptor('persistence.io_failed', {
            debugMessage: toAppErrorDescriptor(error).debugMessage,
          }),
        }
      }
    },
  }
}

function createLocalStoragePort(): PersistencePort | null {
  const storage = getStorage()
  if (!storage) {
    return null
  }

  const readWithLegacyFallback = (key: string, legacyKey: string): string | null =>
    storage.getItem(key) ?? storage.getItem(legacyKey)

  return {
    kind: 'localStorage',
    readAppState: async () => {
      const raw = readWithLegacyFallback(STORAGE_KEY, LEGACY_STORAGE_KEY)
      if (!raw) {
        return { state: null, recovery: null }
      }

      try {
        const parsed = JSON.parse(raw) as unknown
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return { state: null, recovery: null }
        }

        return { state: parsed, recovery: null }
      } catch {
        return { state: null, recovery: null }
      }
    },
    writeAppState: async state => {
      const raw = JSON.stringify(state)

      try {
        storage.setItem(STORAGE_KEY, raw)
        storage.removeItem(LEGACY_STORAGE_KEY)
        return { ok: true, level: 'full', bytes: raw.length }
      } catch (error) {
        return {
          ok: false,
          reason: isQuotaExceededError(error) ? 'quota' : 'unknown',
          error: createAppErrorDescriptor(
            isQuotaExceededError(error)
              ? 'persistence.quota_exceeded'
              : 'persistence.invalid_state',
            {
              debugMessage: toAppErrorDescriptor(error).debugMessage,
            },
          ),
        }
      }
    },
    readNodeScrollback: async nodeId =>
      readWithLegacyFallback(
        `${NODE_SCROLLBACK_KEY_PREFIX}${nodeId}`,
        `${LEGACY_NODE_SCROLLBACK_KEY_PREFIX}${nodeId}`,
      ),
    writeNodeScrollback: async (nodeId, scrollback) => {
      const key = `${NODE_SCROLLBACK_KEY_PREFIX}${nodeId}`
      const legacyKey = `${LEGACY_NODE_SCROLLBACK_KEY_PREFIX}${nodeId}`

      try {
        if (!scrollback || scrollback.length === 0) {
          storage.removeItem(key)
          storage.removeItem(legacyKey)
          return { ok: true, level: 'full', bytes: 0 }
        }

        storage.setItem(key, scrollback)
        storage.removeItem(legacyKey)
        return { ok: true, level: 'full', bytes: scrollback.length }
      } catch (error) {
        return {
          ok: false,
          reason: isQuotaExceededError(error) ? 'quota' : 'unknown',
          error: createAppErrorDescriptor(
            isQuotaExceededError(error)
              ? 'persistence.quota_exceeded'
              : 'persistence.invalid_state',
            {
              debugMessage: toAppErrorDescriptor(error).debugMessage,
            },
          ),
        }
      }
    },
    readWorkspaceStateRaw: async () => readWithLegacyFallback(STORAGE_KEY, LEGACY_STORAGE_KEY),
    writeWorkspaceStateRaw: async raw => {
      try {
        storage.setItem(STORAGE_KEY, raw)
        storage.removeItem(LEGACY_STORAGE_KEY)
        return { ok: true, level: 'full', bytes: raw.length }
      } catch (error) {
        return {
          ok: false,
          reason: isQuotaExceededError(error) ? 'quota' : 'unknown',
          error: createAppErrorDescriptor(
            isQuotaExceededError(error)
              ? 'persistence.quota_exceeded'
              : 'persistence.invalid_state',
            {
              debugMessage: toAppErrorDescriptor(error).debugMessage,
            },
          ),
        }
      }
    },
  }
}

export function getPersistencePort(): PersistencePort | null {
  return createIpcPort() ?? createLocalStoragePort()
}

export function readLegacyLocalStorageRaw(): string | null {
  const storage = getStorage()
  if (!storage) {
    return null
  }

  return storage.getItem(STORAGE_KEY) ?? storage.getItem(LEGACY_STORAGE_KEY)
}
