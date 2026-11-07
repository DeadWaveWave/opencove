import {
  pluginViewOpenOperation,
  pluginViewCloseOperation,
  pluginViewSetTitleOperation,
  pluginInvokeOperation,
  pluginStorageGetOperation,
  pluginStorageSetOperation,
} from '@shared/contracts/controlSurface/operations/domains/plugin'
import type * as z from 'zod'
import type { SchemaOperation } from '@shared/contracts/controlSurface/operations/defineOperation'
import {
  pluginListOperation,
  pluginDetailsOperation,
  pluginInstallOperation,
  pluginReloadOperation,
  pluginUninstallOperation,
  pluginSetEnabledOperation,
} from '@shared/contracts/controlSurface/operations/domains/plugin'
import { registerOperation } from '../registerOperation'
import { registerPluginPreferenceHandlers } from './pluginPreferenceHandlers'
import type { PluginDistributionService } from '@contexts/plugins/application/PluginDistributionService'
import type { ControlSurface } from '../controlSurface'
import type { ControlSurfaceHandler } from '../types'
import { createAppError } from '../../../../shared/errors/appError'
import type { PluginInstallationManager } from '@contexts/plugins/application/PluginInstallationManager'

export function registerPluginHandlers(
  controlSurface: ControlSurface,
  manager: PluginInstallationManager,
  distribution?: PluginDistributionService,
): void {
  const fail = (error: unknown): never => {
    const reason = (error instanceof Error ? error.message : String(error)).slice(0, 2000)
    throw createAppError('plugin.operation_failed', { params: { reason }, debugMessage: reason })
  }
  const registerSchema = <Wire extends z.ZodType, T, R>(
    operation: SchemaOperation<string, 'query' | 'command', Wire, T>,
    handler: Pick<ControlSurfaceHandler<T, R>, 'handle' | 'defaultErrorCode'>,
  ): void => {
    registerOperation(controlSurface, operation, {
      ...handler,
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
  registerSchema(pluginListOperation, {
    handle: async () => ({
      plugins: await manager.list(),
    }),
    defaultErrorCode: 'common.invalid_input',
  })
  registerSchema(pluginDetailsOperation, {
    handle: async (_ctx, input) => manager.details(input.pluginId),
    defaultErrorCode: 'common.invalid_input',
  })
  registerSchema(pluginInstallOperation, {
    handle: async (_ctx, input) => manager.install(input.directory),
    defaultErrorCode: 'common.invalid_input',
  })
  registerSchema(pluginReloadOperation, {
    handle: async (_ctx, input) =>
      distribution ? distribution.rebuild(input.pluginId) : manager.reload(input.pluginId),
    defaultErrorCode: 'common.invalid_input',
  })
  registerSchema(pluginUninstallOperation, {
    handle: async (_ctx, input) => {
      await manager.uninstall(input.pluginId)
      return { ok: true }
    },
    defaultErrorCode: 'common.invalid_input',
  })
  registerSchema(pluginSetEnabledOperation, {
    handle: async (_ctx, input) => manager.setEnabled(input.pluginId, input.enabled),
    defaultErrorCode: 'common.invalid_input',
  })
  registerSchema(pluginViewOpenOperation, {
    handle: async (_ctx, input) => manager.openView(input),
    defaultErrorCode: 'common.invalid_input',
  })
  registerSchema(pluginViewCloseOperation, {
    handle: async (_ctx, input) => {
      await manager.closeView(input.viewId)
      return { ok: true }
    },
    defaultErrorCode: 'common.invalid_input',
  })
  registerSchema(pluginViewSetTitleOperation, {
    handle: async (_ctx, input) => {
      manager.setViewTitle(input.viewId, input.title)
      return { ok: true }
    },
    defaultErrorCode: 'common.invalid_input',
  })
  registerSchema(pluginInvokeOperation, {
    handle: async (_ctx, input) => manager.invoke(input.viewId, input.method, input.params),
    defaultErrorCode: 'common.invalid_input',
  })
  registerSchema(pluginStorageGetOperation, {
    handle: async (_ctx, input) => manager.storageGet(input.viewId, input.key),
    defaultErrorCode: 'common.invalid_input',
  })
  registerSchema(pluginStorageSetOperation, {
    handle: async (_ctx, input) => {
      await manager.storageSet(input.viewId, input.key, input.value)
      return { ok: true }
    },
    defaultErrorCode: 'common.invalid_input',
  })
}
