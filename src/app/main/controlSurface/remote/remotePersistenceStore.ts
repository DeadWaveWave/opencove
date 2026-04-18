import { Buffer } from 'node:buffer'
import type {
  AppErrorDescriptor,
  PersistWriteResult,
  ReadAgentNodePlaceholderScrollbackInput,
  WriteAppStateInput,
  WriteAgentNodePlaceholderScrollbackInput,
  WriteNodeScrollbackInput,
  WriteWorkspaceStateRawInput,
} from '../../../../shared/contracts/dto'
import { createAppErrorDescriptor } from '../../../../shared/errors/appError'
import {
  isPersistedAppState,
  mergePersistedAppStates,
} from '../../../../shared/sync/mergePersistedAppStates'
import type { PersistedAppState } from '../../../../contexts/workspace/presentation/renderer/types'
import type {
  PersistenceRecoveryReason,
  PersistenceStore,
} from '../../../../platform/persistence/sqlite/PersistenceStore'
import type { ControlSurfaceOperationKind } from '../../../../shared/contracts/controlSurface'
import {
  invokeControlSurface,
  type ControlSurfaceRemoteEndpointResolver,
} from './controlSurfaceHttpClient'

function resolveIoFailure(error: unknown): PersistWriteResult {
  return {
    ok: false,
    reason: 'io',
    error: createAppErrorDescriptor('persistence.io_failed', {
      debugMessage:
        error instanceof Error ? `${error.name}: ${error.message}` : 'Remote persistence failed.',
    }),
  }
}

function isAppErrorDescriptor(value: unknown): value is AppErrorDescriptor {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  return typeof (value as { code?: unknown }).code === 'string'
}

async function invokeValue<TResult>(
  endpointResolver: ControlSurfaceRemoteEndpointResolver,
  kind: ControlSurfaceOperationKind,
  id: string,
  payload: unknown,
): Promise<TResult | null> {
  const endpoint = await endpointResolver()
  if (!endpoint) {
    return null
  }

  const { result } = await invokeControlSurface(endpoint, { kind, id, payload })
  if (!result || result.ok === false) {
    return null
  }

  return result.value as TResult
}

async function invokePersistResult(
  endpointResolver: ControlSurfaceRemoteEndpointResolver,
  id: string,
  payload: unknown,
): Promise<PersistWriteResult> {
  const endpoint = await endpointResolver()
  if (!endpoint) {
    return resolveIoFailure(new Error('Remote worker endpoint unavailable.'))
  }

  const { result } = await invokeControlSurface(endpoint, { kind: 'command', id, payload })
  if (!result) {
    return resolveIoFailure(null)
  }

  if (result.ok === false) {
    return { ok: false, reason: 'io', error: result.error }
  }

  return result.value as PersistWriteResult
}

export function createRemotePersistenceStore(
  endpointResolver: ControlSurfaceRemoteEndpointResolver,
): PersistenceStore {
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

  function isRevisionConflictError(value: unknown): boolean {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return false
    }

    const record = value as { code?: unknown; debugMessage?: unknown }
    if (record.code !== 'persistence.invalid_state') {
      return false
    }

    return (
      typeof record.debugMessage === 'string' && record.debugMessage.includes('revision conflict')
    )
  }

  return {
    readWorkspaceStateRaw: async () => {
      try {
        return await invokeValue<string | null>(
          endpointResolver,
          'query',
          'sync.readWorkspaceStateRaw',
          null,
        )
      } catch {
        return null
      }
    },
    writeWorkspaceStateRaw: async raw => {
      const payload: WriteWorkspaceStateRawInput = { raw }
      try {
        return await invokePersistResult(endpointResolver, 'sync.writeWorkspaceStateRaw', payload)
      } catch (error) {
        return resolveIoFailure(error)
      }
    },
    readAppState: async () => {
      try {
        const result = await invokeValue<{ revision: number; state: unknown | null }>(
          endpointResolver,
          'query',
          'sync.state',
          null,
        )
        if (result) {
          setLastKnownSyncRevision(result.revision)
          setLastKnownSyncState(result.state)
        }
        return result?.state ?? null
      } catch {
        return null
      }
    },
    readAppStateRevision: async () => {
      try {
        const result = await invokeValue<{ revision: number; state: unknown | null }>(
          endpointResolver,
          'query',
          'sync.state',
          null,
        )
        if (result) {
          setLastKnownSyncRevision(result.revision)
          setLastKnownSyncState(result.state)
        }
        return typeof result?.revision === 'number' &&
          Number.isFinite(result.revision) &&
          result.revision >= 0
          ? result.revision
          : 0
      } catch {
        return 0
      }
    },
    writeAppState: async state => {
      try {
        const endpoint = await endpointResolver()
        if (!endpoint) {
          return resolveIoFailure(new Error('Remote worker endpoint unavailable.'))
        }

        const ensureBaseRevision = async (): Promise<number | null> => {
          if (typeof lastKnownSyncRevision === 'number') {
            return lastKnownSyncRevision
          }

          const latest = await invokeValue<{ revision: number; state: unknown | null }>(
            endpointResolver,
            'query',
            'sync.state',
            null,
          )
          if (latest) {
            setLastKnownSyncRevision(latest.revision)
            setLastKnownSyncState(latest.state)
            return lastKnownSyncRevision
          }

          return null
        }

        const attemptWrite = async (
          nextState: unknown,
          baseRevision: number | null,
        ): Promise<number> => {
          const payload: WriteAppStateInput & { baseRevision?: number } = {
            state: nextState,
            ...(typeof baseRevision === 'number' ? { baseRevision } : {}),
          }

          const { result } = await invokeControlSurface(endpoint, {
            kind: 'command',
            id: 'sync.writeState',
            payload,
          })

          if (!result) {
            throw new Error('Remote control surface unavailable.')
          }

          if (result.ok === false) {
            throw result.error
          }

          const revision = (result.value as { revision?: unknown }).revision
          if (typeof revision !== 'number' || !Number.isFinite(revision) || revision < 0) {
            throw new Error('sync.writeState returned an invalid revision.')
          }

          setLastKnownSyncRevision(revision)
          setLastKnownSyncState(nextState)
          return Math.floor(revision)
        }

        const baseSnapshot = lastKnownSyncState
        const baseRevision = await ensureBaseRevision()
        if (baseRevision === null) {
          return resolveIoFailure(new Error('Remote worker sync revision unavailable.'))
        }

        try {
          const revision = await attemptWrite(state, baseRevision)
          const bytes = Buffer.byteLength(JSON.stringify(state), 'utf8')
          return { ok: true, level: 'full', bytes, revision }
        } catch (error) {
          if (!isRevisionConflictError(error)) {
            return {
              ok: false,
              reason: 'io',
              error: isAppErrorDescriptor(error)
                ? error
                : createAppErrorDescriptor('persistence.io_failed', {
                    debugMessage:
                      error instanceof Error
                        ? `${error.name}: ${error.message}`
                        : 'Remote persistence failed.',
                  }),
            }
          }

          const latest = await invokeValue<{ revision: number; state: unknown | null }>(
            endpointResolver,
            'query',
            'sync.state',
            null,
          )
          if (!latest) {
            return resolveIoFailure(new Error('Remote worker endpoint unavailable.'))
          }

          setLastKnownSyncRevision(latest.revision)
          setLastKnownSyncState(latest.state)

          const merged =
            latest.state && isPersistedAppState(latest.state) && isPersistedAppState(state)
              ? mergePersistedAppStates(latest.state, state, baseSnapshot)
              : state

          const revision = await attemptWrite(merged, latest.revision)

          const bytes = Buffer.byteLength(JSON.stringify(merged), 'utf8')
          return { ok: true, level: 'full', bytes, revision }
        }
      } catch (error) {
        return resolveIoFailure(error)
      }
    },
    readNodeScrollback: async nodeId => {
      try {
        return await invokeValue<string | null>(
          endpointResolver,
          'query',
          'sync.readNodeScrollback',
          {
            nodeId,
          },
        )
      } catch {
        return null
      }
    },
    writeNodeScrollback: async (nodeId, scrollback) => {
      const payload: WriteNodeScrollbackInput = { nodeId, scrollback }
      try {
        return await invokePersistResult(endpointResolver, 'sync.writeNodeScrollback', payload)
      } catch (error) {
        return resolveIoFailure(error)
      }
    },
    readAgentNodePlaceholderScrollback: async nodeId => {
      const payload: ReadAgentNodePlaceholderScrollbackInput = { nodeId }
      try {
        return await invokeValue<string | null>(
          endpointResolver,
          'query',
          'sync.readAgentNodePlaceholderScrollback',
          payload,
        )
      } catch {
        return null
      }
    },
    writeAgentNodePlaceholderScrollback: async (nodeId, scrollback) => {
      const payload: WriteAgentNodePlaceholderScrollbackInput = { nodeId, scrollback }
      try {
        return await invokePersistResult(
          endpointResolver,
          'sync.writeAgentNodePlaceholderScrollback',
          payload,
        )
      } catch (error) {
        return resolveIoFailure(error)
      }
    },
    consumeRecovery: (): PersistenceRecoveryReason | null => null,
    dispose: () => {
      // noop
    },
  }
}
