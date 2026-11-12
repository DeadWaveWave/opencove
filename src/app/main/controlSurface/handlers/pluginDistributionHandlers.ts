import { pluginRepositoryDetailsOperation } from '@shared/contracts/controlSurface/operations/domains/plugin'
import { createAppError } from '@shared/errors/appError'
import type * as z from 'zod'
import type { SchemaOperation } from '@shared/contracts/controlSurface/operations/defineOperation'
import {
  pluginGitInstallOperation,
  pluginSourceOperation,
  pluginGitCheckOperation,
  pluginGitUpdateOperation,
  pluginGitApplyOperation,
  pluginRollbackOperation,
  pluginDiscoverOperation,
} from '@shared/contracts/controlSurface/operations/domains/plugin'
import { registerOperation } from '../registerOperation'
import type { ControlSurface } from '../controlSurface'
import type { PluginDistributionService } from '@contexts/plugins/application/PluginDistributionService'

export function registerPluginDistributionHandlers(
  surface: ControlSurface,
  service: PluginDistributionService,
): void {
  const fail = (error: unknown): never => {
    const reason = String(error instanceof Error ? error.message : error).slice(0, 2000)
    throw createAppError('plugin.operation_failed', { params: { reason }, debugMessage: reason })
  }

  const registerSchema = <Wire extends z.ZodType, T>(
    operation: SchemaOperation<string, 'query' | 'command', Wire, T>,
    handle: (value: T) => Promise<unknown>,
  ) =>
    registerOperation(surface, operation, {
      handle: async (_ctx, value) => {
        try {
          return await handle(value)
        } catch (error) {
          return fail(error)
        }
      },
      defaultErrorCode: 'common.invalid_input',
    })
  registerSchema(pluginGitInstallOperation, value => service.install(value))
  registerSchema(pluginSourceOperation, value => service.inspect(value))
  registerSchema(pluginGitCheckOperation, value => service.check(value.pluginId, value.ref))
  registerSchema(pluginGitUpdateOperation, value => service.update(value.pluginId, value.ref))
  registerSchema(
    pluginGitApplyOperation,

    value => service.apply(value),
  )
  registerSchema(
    pluginRollbackOperation,

    value => service.rollback(value.pluginId, value.revision),
  )
  registerSchema(pluginRepositoryDetailsOperation, value => service.repositoryDetails(value))
  registerSchema(
    pluginDiscoverOperation,

    value => service.discover(value),
  )
}
