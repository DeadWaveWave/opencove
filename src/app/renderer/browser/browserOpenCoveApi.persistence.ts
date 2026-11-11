import {
  RevisionedSnapshotCache,
  writeRevisionedSnapshot,
} from '@shared/sync/revisionedSnapshotCache'
import { toAppErrorDescriptor } from '@shared/errors/appError'
import { invokeBrowserControlSurface } from './browserControlSurface'
import {
  mergePersistedAppStates,
  normalizeCanonicalPersistedAppStateForMerge,
  normalizePersistedAppStateForMerge,
  type BrowserPersistedAppState,
} from './browserOpenCoveApi.helpers'

import {
  persistenceWriteFailure,
  submitPersistenceWrite,
  classifyWriteResult,
} from '@shared/sync/persistenceWriteOutcome'

type PersistenceApi = Window['opencoveApi']['persistence']

function isStateSnapshot(value: unknown): boolean {
  if (!value || typeof value !== 'object') {
    return false
  }
  const snapshot = value as { revision?: unknown }
  return (
    Number.isSafeInteger(snapshot.revision) &&
    (snapshot.revision as number) >= 0 &&
    Object.hasOwn(value, 'state')
  )
}

export function createBrowserPersistenceApi(): PersistenceApi {
  const cache = new RevisionedSnapshotCache<BrowserPersistedAppState>()
  return {
    readWorkspaceStateRaw: async () =>
      await invokeBrowserControlSurface<string | null>(
        {
          kind: 'query',
          id: 'sync.readWorkspaceStateRaw',
          payload: null,
        },
        value => value === null || typeof value === 'string',
      ),
    writeWorkspaceStateRaw: async payload => {
      try {
        const result = await submitPersistenceWrite(() =>
          invokeBrowserControlSurface<import('@shared/contracts/dto').PersistWriteResult>({
            kind: 'command',
            id: 'sync.writeWorkspaceStateRaw',
            payload,
          }),
        )
        if (result.ok) {
          cache.invalidate()
        }
        return classifyWriteResult(result)
      } catch (error) {
        return persistenceWriteFailure(error)
      }
    },
    readAppState: async () => {
      const value = await invokeBrowserControlSurface<{
        revision: number
        state: unknown | null
      }>(
        {
          kind: 'query',
          id: 'sync.state',
          payload: null,
        },
        isStateSnapshot,
      )
      cache.set(value.revision, normalizePersistedAppStateForMerge(value.state))
      return { state: value.state, recovery: null, revision: value.revision }
    },
    writeAppState: async payload => {
      try {
        const result = await writeRevisionedSnapshot({
          cache,
          preflight: false,
          baseRevision: payload.baseRevision,
          state: payload.state,
          read: async () => {
            const value = await invokeBrowserControlSurface<{ revision: number; state: unknown }>(
              {
                kind: 'query',
                id: 'sync.state',
                payload: null,
              },
              isStateSnapshot,
            )
            const state = normalizePersistedAppStateForMerge(value.state)
            if (value.state !== null && !state) {
              throw new Error('Malformed sync state.')
            }
            return { revision: value.revision, state }
          },
          write: async (state, baseRevision) => {
            const written = await invokeBrowserControlSurface<
              import('@shared/sync/revisionedSnapshotCache').RevisionedWriteReceipt
            >({
              kind: 'command',
              id: 'sync.writeState',
              payload: {
                state,
                ...(baseRevision === null ? {} : { baseRevision }),
                allowEmptyWorkspaceOverwrite: payload.allowEmptyWorkspaceOverwrite === true,
              },
            })
            return written
          },
          normalize: normalizeCanonicalPersistedAppStateForMerge,
          merge: mergePersistedAppStates,
          isConflict: error => {
            const descriptor = toAppErrorDescriptor(error, 'persistence.invalid_state')
            return (
              descriptor.code === 'persistence.invalid_state' &&
              descriptor.details !== null &&
              typeof descriptor.details === 'object' &&
              'reason' in descriptor.details &&
              descriptor.details.reason === 'revisionConflict'
            )
          },
        })
        return {
          ok: true,
          level: 'full',
          bytes: JSON.stringify(result.state).length,
          revision: result.revision,
          merged: result.merged,
          corrected: result.corrected,
          uncertain: result.uncertain,
        }
      } catch (error) {
        return persistenceWriteFailure(error, 'notSubmitted')
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
