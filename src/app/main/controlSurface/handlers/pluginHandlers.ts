import { registerPluginPreferenceHandlers } from './pluginPreferenceHandlers'
import type { PluginDistributionService } from '@contexts/plugins/application/PluginDistributionService'
import type { ControlSurface } from '../controlSurface'
import type { ControlSurfaceHandler } from '../types'
import { createAppError } from '../../../../shared/errors/appError'
import type { PluginInstallationManager } from '@contexts/plugins/application/PluginInstallationManager'
import { pluginRecord, pluginString } from '@contexts/plugins/domain/localPluginValidation'
import type { PluginOpenViewInput } from '@contexts/plugins/domain/pluginRuntimeTypes'

function pluginId(payload: unknown): { pluginId: string } {
  return { pluginId: pluginString(pluginRecord(payload).pluginId, 'id', 80) }
}
function viewInput(payload: unknown): { viewId: string } {
  return { viewId: pluginString(pluginRecord(payload).viewId, 'viewId', 100) }
}
function storageInput(payload: unknown): { viewId: string; key: string; value: unknown } {
  const record = pluginRecord(payload)
  const key = pluginString(record.key, 'storage key', 100)
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/.test(key)) {
    throw new Error('Invalid plugin storage key.')
  }
  return { ...viewInput(payload), key, value: record.value }
}
function jsonValue(value: unknown, maxBytes: number): unknown {
  const json = JSON.stringify(value ?? null)
  if (json.length > maxBytes) {
    throw new Error('Plugin payload is too large.')
  }
  return JSON.parse(json) as unknown
}

export function registerPluginHandlers(
  controlSurface: ControlSurface,
  manager: PluginInstallationManager,
  distribution?: PluginDistributionService,
): void {
  const fail = (error: unknown): never => {
    const reason = (error instanceof Error ? error.message : String(error)).slice(0, 2000)
    throw createAppError('plugin.operation_failed', { params: { reason }, debugMessage: reason })
  }
  const register = <T, R>(id: string, handler: ControlSurfaceHandler<T, R>): void => {
    controlSurface.register(id, {
      ...handler,
      validate: value => {
        try {
          return handler.validate(value)
        } catch (error) {
          return fail(error)
        }
      },
      handle: async (ctx, value) => {
        try {
          return await handler.handle(ctx, value)
        } catch (error) {
          return fail(error)
        }
      },
    })
  }
  registerPluginPreferenceHandlers(controlSurface, manager)
  register('plugin.list', {
    kind: 'query',
    validate: () => null,
    handle: async () => ({
      plugins: await manager.list(),
    }),
    defaultErrorCode: 'common.invalid_input',
  })
  register('plugin.details', {
    kind: 'query',
    validate: pluginId,
    handle: async (_ctx, input) => manager.details(input.pluginId),
    defaultErrorCode: 'common.invalid_input',
  })
  register('plugin.install', {
    kind: 'command',
    validate: payload => ({
      directory: pluginString(pluginRecord(payload).directory, 'directory', 4096),
    }),
    handle: async (_ctx, input) => manager.install(input.directory),
    defaultErrorCode: 'common.invalid_input',
  })
  register('plugin.reload', {
    kind: 'command',
    validate: pluginId,
    handle: async (_ctx, input) =>
      distribution ? distribution.rebuild(input.pluginId) : manager.reload(input.pluginId),
    defaultErrorCode: 'common.invalid_input',
  })
  register('plugin.uninstall', {
    kind: 'command',
    validate: pluginId,
    handle: async (_ctx, input) => {
      await manager.uninstall(input.pluginId)
      return { ok: true }
    },
    defaultErrorCode: 'common.invalid_input',
  })
  register('plugin.setEnabled', {
    kind: 'command',
    validate: payload => {
      const record = pluginRecord(payload)
      if (typeof record.enabled !== 'boolean') {
        throw new Error('Plugin enabled must be a boolean.')
      }
      return { ...pluginId(payload), enabled: record.enabled }
    },
    handle: async (_ctx, input) => manager.setEnabled(input.pluginId, input.enabled),
    defaultErrorCode: 'common.invalid_input',
  })
  register('plugin.view.open', {
    kind: 'command',
    validate: payload => {
      const record = pluginRecord(payload)
      if (record.preview !== undefined && typeof record.preview !== 'boolean') {
        throw new Error('Plugin preview must be a boolean.')
      }
      return {
        ...pluginId(payload),
        nodeId: pluginString(record.nodeId, 'nodeId', 200),
        workspaceId:
          record.workspaceId === null || record.workspaceId === undefined
            ? null
            : pluginString(record.workspaceId, 'workspaceId', 200),
        directoryPath:
          record.directoryPath === null || record.directoryPath === undefined
            ? null
            : pluginString(record.directoryPath, 'directoryPath', 4096),
        preview: record.preview === true,
      } satisfies PluginOpenViewInput
    },
    handle: async (_ctx, input) => manager.openView(input),
    defaultErrorCode: 'common.invalid_input',
  })
  register('plugin.view.close', {
    kind: 'command',
    validate: viewInput,
    handle: async (_ctx, input) => {
      await manager.closeView(input.viewId)
      return { ok: true }
    },
    defaultErrorCode: 'common.invalid_input',
  })
  register('plugin.view.setTitle', {
    kind: 'command',
    validate: payload => ({
      ...viewInput(payload),
      title: pluginString(pluginRecord(payload).title, 'window title', 200),
    }),
    handle: async (_ctx, input) => {
      manager.setViewTitle(input.viewId, input.title)
      return { ok: true }
    },
    defaultErrorCode: 'common.invalid_input',
  })
  register('plugin.invoke', {
    kind: 'command',
    validate: payload => {
      const record = pluginRecord(payload)
      return {
        ...viewInput(payload),
        method: pluginString(record.method, 'method', 200),
        params: jsonValue(record.params, 1024 * 1024),
      }
    },
    handle: async (_ctx, input) => manager.invoke(input.viewId, input.method, input.params),
    defaultErrorCode: 'common.invalid_input',
  })
  register('plugin.storage.get', {
    kind: 'query',
    validate: storageInput,
    handle: async (_ctx, input) => manager.storageGet(input.viewId, input.key),
    defaultErrorCode: 'common.invalid_input',
  })
  register('plugin.storage.set', {
    kind: 'command',
    validate: payload => {
      const input = storageInput(payload)
      return { ...input, value: jsonValue(input.value, 1024 * 1024) }
    },
    handle: async (_ctx, input) => {
      await manager.storageSet(input.viewId, input.key, input.value)
      return { ok: true }
    },
    defaultErrorCode: 'common.invalid_input',
  })
}
