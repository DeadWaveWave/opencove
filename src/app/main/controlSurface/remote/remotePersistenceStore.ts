import {
  RevisionedSnapshotCache,
  writeRevisionedSnapshot,
} from '../../../../shared/sync/revisionedSnapshotCache'
import {
  persistenceWriteFailure,
  submitPersistenceWrite,
  classifyWriteResult,
} from '../../../../shared/sync/persistenceWriteOutcome'
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

function resolveIoFailure(
  error: unknown,
  outcome?: 'unknown' | 'notSubmitted',
): PersistWriteResult {
  return {
    ok: false,
    reason: 'io',
    ...(outcome ? { outcome } : {}),
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
    return resolveIoFailure(new Error('Remote worker endpoint unavailable.'), 'notSubmitted')
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
  const cache = new RevisionedSnapshotCache<RemotePersistedAppState>()
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
        const endpoint = await endpointResolver()
        if (!endpoint) {
          return resolveIoFailure(new Error('Remote worker endpoint unavailable.'), 'notSubmitted')
        }
        const result = await submitPersistenceWrite(() =>
          invokePersistResult(async () => endpoint, 'sync.writeWorkspaceStateRaw', payload),
        )
        if (result.ok) {
          cache.invalidate()
        }
        return classifyWriteResult(result)
      } catch (error) {
        return persistenceWriteFailure(error, 'notSubmitted')
      }
    },
    readAppStateSnapshot: async () => {
      const result = requireRemoteAppStateSnapshot(
        await invokeRequiredValue<unknown>(endpointResolver, 'query', 'sync.state', null),
      )
      cache.set(result.revision, result.state)
      return { state: result.rawState, revision: result.revision }
    },
    readAppState: async () => {
      const result = requireRemoteAppStateSnapshot(
        await invokeRequiredValue<unknown>(endpointResolver, 'query', 'sync.state', null),
      )

      cache.set(result.revision, result.state)
      return result.rawState
    },
    readAppStateRevision: async () => {
      try {
        const result = requireRemoteAppStateSnapshot(
          await invokeRequiredValue<unknown>(endpointResolver, 'query', 'sync.state', null),
        )

        cache.set(result.revision, result.state)
        return result.revision
      } catch {
        return 0
      }
    },
    writeAppState: async (state, options) => {
      try {
        const endpoint = await endpointResolver()
        if (!endpoint) {
          return resolveIoFailure(new Error('Remote worker endpoint unavailable.'), 'notSubmitted')
        }

        const readLatestSnapshot = async (): Promise<RemoteAppStateSnapshot> =>
          requireRemoteAppStateSnapshot(
            await invokeRequiredValueAtEndpoint<unknown>(endpoint, 'query', 'sync.state', null),
          )

        const attemptWrite = async (
          nextState: unknown,
          baseRevision: number | null,
        ): Promise<
          import('../../../../shared/sync/revisionedSnapshotCache').RevisionedWriteReceipt
        > => {
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

          return result.value as import('../../../../shared/sync/revisionedSnapshotCache').RevisionedWriteReceipt
        }

        const result = await writeRevisionedSnapshot({
          cache,
          baseRevision: options?.baseRevision,
          state,
          read: readLatestSnapshot,
          write: attemptWrite,
          normalize: normalizeLocalPersistedAppState,
          merge: mergePersistedAppStates,
          isConflict: isRevisionConflictError,
        })
        return {
          ok: true,
          level: 'full',
          bytes: Buffer.byteLength(JSON.stringify(result.state), 'utf8'),
          revision: result.revision,
          merged: result.merged,
          corrected: result.corrected,
          uncertain: result.uncertain,
        }
      } catch (error) {
        // Keep the Worker's own rejection (for example the empty-workspace overwrite guard).
        return persistenceWriteFailure(error, 'notSubmitted')
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
