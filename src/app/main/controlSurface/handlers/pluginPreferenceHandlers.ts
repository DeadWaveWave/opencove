import type { ControlSurfaceHandler } from '../types'
import { registerOperation } from '../registerOperation'
import {
  pluginViewPreferencesSetOperation,
  pluginViewPreferencesGetOperation,
  pluginPreferencesSetOperation,
  pluginPreferencesGetOperation,
} from '@shared/contracts/controlSurface/operations/domains/plugin'
import type { ControlSurface } from '../controlSurface'
import type { PluginInstallationManager } from '@contexts/plugins/application/PluginInstallationManager'
import { createAppError } from '../../../../shared/errors/appError'

export function registerPluginPreferenceHandlers(
  control: ControlSurface,
  manager: PluginInstallationManager,
): void {
  for (const view of [false, true]) {
    for (const write of [false, true]) {
      const handler: Pick<
        ControlSurfaceHandler<{ id: string; key: string; value: unknown }, unknown>,
        'handle' | 'defaultErrorCode'
      > = {
        handle: async (_ctx, input) => {
          try {
            if (view) {
              return write
                ? await manager.viewPreferencesSet(input.id, input.key, input.value)
                : await manager.viewPreferencesGet(input.id)
            }
            return write
              ? await manager.preferencesSet(input.id, input.key, input.value)
              : await manager.preferencesGet(input.id)
          } catch (error) {
            const reason = error instanceof Error ? error.message : String(error)
            throw createAppError('plugin.operation_failed', {
              params: { reason },
              debugMessage: reason,
            })
          }
        },
        defaultErrorCode: 'common.invalid_input',
      }
      if (view) {
        if (write) {
          registerOperation(control, pluginViewPreferencesSetOperation, handler)
        } else {
          registerOperation(control, pluginViewPreferencesGetOperation, handler)
        }
      } else if (write) {
        registerOperation(control, pluginPreferencesSetOperation, handler)
      } else {
        registerOperation(control, pluginPreferencesGetOperation, handler)
      }
    }
  }
}
