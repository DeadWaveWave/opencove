import { randomUUID } from 'node:crypto'
import type { PluginInstallationManager } from '../../../../contexts/plugins/application/PluginInstallationManager'
import { PluginTargetOperations } from '../../../../contexts/plugins/application/PluginTargetOperations'
import type {
  PluginHostAuthority,
  PluginResolvedTarget,
} from '../../../../contexts/plugins/domain/pluginHostTypes'
import {
  pluginRecord,
  pluginString,
} from '../../../../contexts/plugins/domain/localPluginValidation'
import { pluginJsonValue } from '../../../../contexts/plugins/domain/pluginJsonValue'
import type { PersistenceStore } from '../../../../platform/persistence/sqlite/PersistenceStore'
import type {
  ReadDirectoryResult,
  FileSystemStat,
  ReadFileTextResult,
  SpawnTerminalResult,
} from '../../../../shared/contracts/dto'
import { createAppError } from '../../../../shared/errors/appError'
import type { ControlSurface } from '../controlSurface'
import type { ControlSurfaceContext } from '../types'
import type { WorkerTopologyStore } from '../topology/topologyStore'
import { assertFileUriWithinRootUri } from '../topology/fileUriScope'
import type { MultiEndpointPtyRuntime } from '../ptyStream/multiEndpointPtyRuntime'
import type { PtyStreamHub } from '../ptyStream/ptyStreamHub'
import {
  listPluginTargets,
  pluginRelativeUri,
  pluginTargetInput,
  resolvePluginTarget,
} from './pluginTargetResolution'

function fields(payload: unknown, allowed: string[]) {
  const record = pluginRecord(payload)
  if (Object.keys(record).some(key => !allowed.includes(key))) {
    throw new Error('Unsupported plugin host argument.')
  }
  return record
}

export function registerPluginHostHandlers(
  control: ControlSurface,
  deps: {
    plugins: PluginInstallationManager
    getPersistenceStore(): Promise<PersistenceStore>
    topology: WorkerTopologyStore
    ptyRuntime: MultiEndpointPtyRuntime
    ptyStreamHub: PtyStreamHub
    context: ControlSurfaceContext
  },
): void {
  const invoke = async <T>(id: string, kind: 'query' | 'command', payload: unknown): Promise<T> => {
    const result = await control.invoke(deps.context, { id, kind, payload })
    if (!result.ok) {
      throw createAppError(result.error)
    }
    return result.value as T
  }
  const revalidate = async (target: PluginResolvedTarget) => {
    const current = await resolvePluginTarget(
      { projectId: target.projectId, ...(target.spaceId ? { spaceId: target.spaceId } : {}) },
      deps,
    )
    if (JSON.stringify(current) !== JSON.stringify(target)) {
      throw new Error('Plugin target changed before dispatch; resolve it again.')
    }
  }
  const operations = new PluginTargetOperations(
    {
      spawn: async (target, command, args, assertActive) => {
        await revalidate(target)
        assertActive()
        const result = await invoke<SpawnTerminalResult>('pty.spawnInMount', 'command', {
          mountId: target.mountId,
          cwdUri: target.cwdUri,
          command,
          args,
          cols: 120,
          rows: 30,
        })
        return result.sessionId
      },
      snapshot: sessionId => {
        const session = deps.ptyStreamHub
          .listSessions()
          .sessions.find(item => item.sessionId === sessionId)
        if (!session) {
          throw new Error('Target operation session is unavailable.')
        }
        const snapshot = deps.ptyStreamHub.snapshotSession(sessionId)
        return {
          output: snapshot.scrollback,
          truncated: snapshot.truncated,
          exitCode: session.exitCode,
          exited: session.status === 'exited',
        }
      },
      kill: sessionId => deps.ptyRuntime.kill(sessionId),
      forget: sessionId => deps.ptyStreamHub.retireSession(sessionId),
    },
    randomUUID,
  )
  const request = async (
    authority: PluginHostAuthority,
    operation: string,
    payload: unknown,
  ): Promise<unknown> => {
    authority.assertActive()
    payload = pluginJsonValue(payload, 64 * 1024, 'host request')
    if (operation === 'target.list') {
      fields(payload, [])
      return listPluginTargets(deps)
    }
    if (operation === 'operations.get' || operation === 'operations.cancel') {
      const input = fields(payload, ['operationId'])
      const id = pluginString(input.operationId, 'operationId', 100)
      return operation === 'operations.get'
        ? operations.get(authority.ownerId, id)
        : operations.cancel(authority.ownerId, id)
    }
    if (operation === 'target.resolve') {
      return resolvePluginTarget(pluginTargetInput(payload), deps)
    }
    if (
      !['filesystem.readDirectory', 'filesystem.readText', 'operations.start'].includes(operation)
    ) {
      throw new Error('Unsupported plugin host operation.')
    }
    const input = fields(
      payload,
      operation === 'operations.start'
        ? ['target', 'command', 'args', 'timeoutMs']
        : ['target', 'path'],
    )
    const target = await resolvePluginTarget(pluginTargetInput(input.target), deps)
    authority.assertActive()
    if (operation === 'operations.start') {
      const command = pluginString(input.command, 'command', 4096)
      if (command.includes('\0')) {
        throw new Error('Invalid operation executable.')
      }
      const args = input.args ?? []
      if (
        !Array.isArray(args) ||
        args.length > 128 ||
        args.some(value => typeof value !== 'string' || value.length > 8192 || value.includes('\0'))
      ) {
        throw new Error('Invalid operation arguments.')
      }
      const timeoutMs = input.timeoutMs ?? 30_000
      if (
        typeof timeoutMs !== 'number' ||
        !Number.isInteger(timeoutMs) ||
        timeoutMs < 100 ||
        timeoutMs > 120_000
      ) {
        throw new Error('Operation timeout must be between 100 and 120000 milliseconds.')
      }
      return operations.start(authority, target, command, args as string[], timeoutMs)
    }
    const uri = pluginRelativeUri(target, input.path)
    assertFileUriWithinRootUri({
      rootUri: target.rootUri,
      uri,
      debugMessage: 'Plugin file path is outside target scope.',
    })
    await revalidate(target)
    authority.assertActive()
    if (operation === 'filesystem.readDirectory') {
      const result = await invoke<ReadDirectoryResult>('filesystem.readDirectoryInMount', 'query', {
        mountId: target.mountId,
        uri,
        maxEntries: 1000,
      })
      // Older targets may not implement the optional provider-side limit yet.
      return pluginJsonValue(
        {
          target,
          entries: result.entries.slice(0, 1000),
          truncated: result.truncated === true || result.entries.length > 1000,
        },
        1024 * 1024,
        'directory response',
      )
    }
    const stat = await invoke<FileSystemStat>('filesystem.statInMount', 'query', {
      mountId: target.mountId,
      uri,
    })
    authority.assertActive()
    if (stat.kind !== 'file' || stat.sizeBytes === null || stat.sizeBytes > 1024 * 1024) {
      throw new Error('Plugin text reads require a regular file no larger than 1 MiB.')
    }
    const result = await invoke<ReadFileTextResult>('filesystem.readFileTextInMount', 'query', {
      mountId: target.mountId,
      uri,
      maxBytes: 1024 * 1024,
    })
    if (new TextEncoder().encode(result.content).byteLength > 1024 * 1024) {
      throw new Error('File exceeds the text read limit.')
    }
    return { target, content: result.content }
  }
  deps.plugins.configureHost({ request, retire: ownerId => operations.retire(ownerId) })
  const fail = (error: unknown): never => {
    const reason = (error instanceof Error ? error.message : String(error)).slice(0, 2000)
    throw createAppError('plugin.operation_failed', { params: { reason }, debugMessage: reason })
  }
  control.register('plugin.host.request', {
    kind: 'command',
    validate: value => {
      const input = fields(value, ['viewId', 'operation', 'payload'])
      return {
        viewId: pluginString(input.viewId, 'viewId', 100),
        operation: pluginString(input.operation, 'host operation', 100),
        payload: pluginJsonValue(input.payload, 64 * 1024, 'host request'),
      }
    },
    handle: async (_ctx, input) => {
      try {
        return await deps.plugins.hostRequest(input.viewId, input.operation, input.payload)
      } catch (error) {
        return fail(error)
      }
    },
    defaultErrorCode: 'plugin.operation_failed',
  })
}
