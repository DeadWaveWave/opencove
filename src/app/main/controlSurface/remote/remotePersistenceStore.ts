import { Buffer } from 'node:buffer'
import type {
  PersistWriteResult,
  WriteAppStateInput,
  WriteNodeScrollbackInput,
  WriteWorkspaceStateRawInput,
} from '../../../../shared/contracts/dto'
import { createAppErrorDescriptor } from '../../../../shared/errors/appError'
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
      const payload: WriteAppStateInput = { state }
      const bytes = Buffer.byteLength(JSON.stringify(state), 'utf8')

      try {
        const endpoint = await endpointResolver()
        if (!endpoint) {
          return resolveIoFailure(new Error('Remote worker endpoint unavailable.'))
        }

        const { result } = await invokeControlSurface(endpoint, {
          kind: 'command',
          id: 'sync.writeState',
          payload,
        })

        if (!result) {
          return resolveIoFailure(null)
        }

        if (result.ok === false) {
          return { ok: false, reason: 'io', error: result.error }
        }

        return { ok: true, level: 'full', bytes }
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
    consumeRecovery: (): PersistenceRecoveryReason | null => null,
    dispose: () => {
      // noop
    },
  }
}
