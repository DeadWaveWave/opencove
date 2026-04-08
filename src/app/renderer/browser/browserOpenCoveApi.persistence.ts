import { toAppErrorDescriptor } from '@shared/errors/appError'
import { invokeBrowserControlSurface } from './browserControlSurface'
import { isPersistedAppState, mergePersistedAppStates } from './browserOpenCoveApi.helpers'
import type { PersistedAppState } from '@contexts/workspace/presentation/renderer/types'

type PersistenceApi = Window['opencoveApi']['persistence']

let lastKnownSyncRevision: number | null = null
let lastKnownSyncState: PersistedAppState | null = null

function setLastKnownSyncRevision(value: unknown): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return
  }

  lastKnownSyncRevision = Math.floor(value)
}

function setLastKnownSyncState(value: unknown): void {
  lastKnownSyncState = isPersistedAppState(value) ? value : null
}

export function createBrowserPersistenceApi(): PersistenceApi {
  return {
    readWorkspaceStateRaw: async () =>
      await invokeBrowserControlSurface<string | null>({
        kind: 'query',
        id: 'sync.readWorkspaceStateRaw',
        payload: null,
      }),
    writeWorkspaceStateRaw: async payload =>
      await invokeBrowserControlSurface({
        kind: 'command',
        id: 'sync.writeWorkspaceStateRaw',
        payload,
      }),
    readAppState: async () => {
      const value = await invokeBrowserControlSurface<{
        revision: number
        state: unknown | null
      }>({
        kind: 'query',
        id: 'sync.state',
        payload: null,
      })
      setLastKnownSyncRevision(value.revision)
      setLastKnownSyncState(value.state)
      return { state: value.state, recovery: null }
    },
    writeAppState: async payload => {
      const attemptWrite = async (state: unknown, baseRevision: number | null): Promise<number> => {
        const response = await invokeBrowserControlSurface<{ revision: number }>({
          kind: 'command',
          id: 'sync.writeState',
          payload: {
            state,
            ...(typeof baseRevision === 'number' ? { baseRevision } : {}),
          },
        })
        setLastKnownSyncRevision(response.revision)
        setLastKnownSyncState(state)
        return response.revision
      }

      const state = payload.state

      const baseSnapshot = lastKnownSyncState

      try {
        const baseRevision =
          typeof lastKnownSyncRevision === 'number' ? lastKnownSyncRevision : null
        const revision = await attemptWrite(state, baseRevision)

        return {
          ok: true,
          level: 'full',
          bytes: JSON.stringify(state).length,
          revision,
        } as const
      } catch (error) {
        const descriptor = toAppErrorDescriptor(error, 'persistence.invalid_state')
        const debugMessage = descriptor.debugMessage ?? ''
        const isRevisionConflict =
          descriptor.code === 'persistence.invalid_state' &&
          debugMessage.includes('revision conflict')

        if (!isRevisionConflict) {
          return { ok: false, reason: 'unknown', error: descriptor } as const
        }

        try {
          const latest = await invokeBrowserControlSurface<{
            revision: number
            state: unknown | null
          }>({
            kind: 'query',
            id: 'sync.state',
            payload: null,
          })
          setLastKnownSyncRevision(latest.revision)
          setLastKnownSyncState(latest.state)

          const merged =
            latest.state && isPersistedAppState(latest.state) && isPersistedAppState(state)
              ? mergePersistedAppStates(latest.state, state, baseSnapshot)
              : state

          const revision = await attemptWrite(merged, latest.revision)

          return {
            ok: true,
            level: 'full',
            bytes: JSON.stringify(merged).length,
            revision,
          } as const
        } catch (retryError) {
          return {
            ok: false,
            reason: 'unknown',
            error: toAppErrorDescriptor(retryError, 'persistence.invalid_state'),
          } as const
        }
      }
    },
    readNodeScrollback: async payload =>
      await invokeBrowserControlSurface<string | null>({
        kind: 'query',
        id: 'sync.readNodeScrollback',
        payload,
      }),
    writeNodeScrollback: async payload =>
      await invokeBrowserControlSurface({
        kind: 'command',
        id: 'sync.writeNodeScrollback',
        payload,
      }),
    readAgentNodePlaceholderScrollback: async () => null,
    writeAgentNodePlaceholderScrollback: async () => ({
      ok: true,
      level: 'full',
      bytes: 0,
    }),
  }
}
