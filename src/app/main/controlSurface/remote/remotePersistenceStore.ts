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
import { createAppError, createAppErrorDescriptor } from '../../../../shared/errors/appError'
import { mergePersistedAppStates } from '../../../../shared/sync/mergePersistedAppStates'
import { normalizePersistedAppStateForMerge } from '../../../../shared/sync/normalizePersistedAppStateForMerge'
import type { NormalizedPersistedAppStateContract } from '../../../../shared/contracts/normalizedPersistedAppState'
import {
  isNormalizedAgentSettings,
  normalizeAgentSettings,
  type AgentSettings,
} from '../../../../contexts/settings/domain/agentSettings'
import type {
  PersistenceRecoveryReason,
  PersistenceStore,
} from '../../../../platform/persistence/sqlite/PersistenceStore'
import type { ControlSurfaceOperationKind } from '../../../../shared/contracts/controlSurface'
import {
  invokeControlSurface,
  type ControlSurfaceRemoteEndpoint,
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

function createRemoteReadUnavailableError(error: unknown, fallback: string) {
  const debugMessage = error instanceof Error ? `${error.name}: ${error.message}` : fallback
  return createAppError('persistence.unavailable', { debugMessage })
}

type RemotePersistedAppState = NormalizedPersistedAppStateContract<AgentSettings>

type RemoteAppStateSnapshot = {
  revision: number
  state: RemotePersistedAppState | null
  rawState: unknown | null
}

function normalizeRemotePersistedAppState(value: unknown): RemotePersistedAppState | null {
  return normalizePersistedAppStateForMerge(value, settings => normalizeAgentSettings(settings))
}

function normalizeLocalPersistedAppState(value: unknown): RemotePersistedAppState | null {
  return normalizePersistedAppStateForMerge(value, settings =>
    isNormalizedAgentSettings(settings) ? settings : null,
  )
}

function requireRemoteAppStateSnapshot(value: unknown): RemoteAppStateSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw createRemoteReadUnavailableError(null, 'Remote persistence response was malformed.')
  }

  const record = value as Record<string, unknown>
  const state = record.state === null ? null : normalizeRemotePersistedAppState(record.state)
  if (
    typeof record.revision !== 'number' ||
    !Number.isSafeInteger(record.revision) ||
    record.revision < 0 ||
    (record.state !== null && state === null)
  ) {
    throw createRemoteReadUnavailableError(null, 'Remote persistence response was malformed.')
  }

  return { revision: record.revision, state, rawState: record.state }
}

async function invokeRequiredValueAtEndpoint<TResult>(
  endpoint: ControlSurfaceRemoteEndpoint,
  kind: ControlSurfaceOperationKind,
  id: string,
  payload: unknown,
): Promise<TResult> {
  const { result } = await invokeControlSurface(endpoint, { kind, id, payload }).catch(error => {
    throw createRemoteReadUnavailableError(error, 'Remote persistence transport failed.')
  })

  if (!result) {
    throw createRemoteReadUnavailableError(null, 'Remote persistence response unavailable.')
  }

  const resultRecord = result as unknown as {
    ok?: unknown
    error?: unknown
    value?: unknown
  }
  if (resultRecord.ok === false) {
    if (!isAppErrorDescriptor(resultRecord.error)) {
      throw createRemoteReadUnavailableError(null, 'Remote persistence response was malformed.')
    }
    throw createAppError(resultRecord.error)
  }
  if (resultRecord.ok !== true) {
    throw createRemoteReadUnavailableError(null, 'Remote persistence response was malformed.')
  }

  return resultRecord.value as TResult
}

async function invokeRequiredValue<TResult>(
  endpointResolver: ControlSurfaceRemoteEndpointResolver,
  kind: ControlSurfaceOperationKind,
  id: string,
  payload: unknown,
): Promise<TResult> {
  let endpoint: Awaited<ReturnType<ControlSurfaceRemoteEndpointResolver>>
  try {
    endpoint = await endpointResolver()
  } catch (error) {
    throw createRemoteReadUnavailableError(error, 'Remote worker endpoint unavailable.')
  }

  if (!endpoint) {
    throw createRemoteReadUnavailableError(null, 'Remote worker endpoint unavailable.')
  }

  return await invokeRequiredValueAtEndpoint<TResult>(endpoint, kind, id, payload)
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
  let lastKnownSyncState: RemotePersistedAppState | null = null

  function setLastKnownSyncRevision(value: unknown): void {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
      return
    }

    lastKnownSyncRevision = value
  }

  function setLastKnownSyncState(value: unknown): void {
    lastKnownSyncState = normalizeRemotePersistedAppState(value)
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
      const result = requireRemoteAppStateSnapshot(
        await invokeRequiredValue<unknown>(endpointResolver, 'query', 'sync.state', null),
      )
      setLastKnownSyncRevision(result.revision)
      lastKnownSyncState = result.state
      return result.rawState
    },
    readAppStateRevision: async () => {
      try {
        const result = requireRemoteAppStateSnapshot(
          await invokeRequiredValue<unknown>(endpointResolver, 'query', 'sync.state', null),
        )
        setLastKnownSyncRevision(result.revision)
        setLastKnownSyncState(result.state)
        return result.revision
      } catch {
        return 0
      }
    },
    writeAppState: async (state, options) => {
      try {
        const endpoint = await endpointResolver()
        if (!endpoint) {
          return resolveIoFailure(new Error('Remote worker endpoint unavailable.'))
        }

        const readLatestSnapshot = async (): Promise<RemoteAppStateSnapshot> =>
          requireRemoteAppStateSnapshot(
            await invokeRequiredValueAtEndpoint<unknown>(endpoint, 'query', 'sync.state', null),
          )

        const ensureBaseSnapshot = async (): Promise<RemoteAppStateSnapshot> => {
          if (typeof lastKnownSyncRevision === 'number') {
            return {
              revision: lastKnownSyncRevision,
              state: lastKnownSyncState,
              rawState: lastKnownSyncState,
            }
          }

          const latest = await readLatestSnapshot()
          setLastKnownSyncRevision(latest.revision)
          setLastKnownSyncState(latest.state)
          return latest
        }

        const attemptWrite = async (
          nextState: unknown,
          baseRevision: number | null,
        ): Promise<number> => {
          const payload: WriteAppStateInput & { baseRevision?: number } = {
            state: nextState,
            ...(typeof baseRevision === 'number' ? { baseRevision } : {}),
            ...(options?.allowEmptyWorkspaceOverwrite === true
              ? { allowEmptyWorkspaceOverwrite: true }
              : {}),
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
          if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0) {
            throw new Error('sync.writeState returned an invalid revision.')
          }

          setLastKnownSyncRevision(revision)
          setLastKnownSyncState(nextState)
          return revision
        }

        const base = await ensureBaseSnapshot()
        const baseSnapshot = base.state

        try {
          const revision = await attemptWrite(state, base.revision)
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

          const latest = await readLatestSnapshot()
          setLastKnownSyncRevision(latest.revision)
          setLastKnownSyncState(latest.state)

          const localState = normalizeLocalPersistedAppState(state)
          if (!localState) {
            throw new Error('Local persistence state was not canonical after revision conflict.', {
              cause: error,
            })
          }
          const merged = latest.state
            ? mergePersistedAppStates(latest.state, localState, baseSnapshot)
            : localState

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
