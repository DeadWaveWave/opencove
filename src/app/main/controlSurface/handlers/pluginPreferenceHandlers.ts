import type { ControlSurface } from '../controlSurface'
import type { PluginInstallationManager } from '@contexts/plugins/application/PluginInstallationManager'
import { pluginRecord, pluginString } from '@contexts/plugins/domain/localPluginValidation'
import { createAppError } from '../../../../shared/errors/appError'

export function registerPluginPreferenceHandlers(
  control: ControlSurface,
  manager: PluginInstallationManager,
): void {
  for (const view of [false, true]) {
    for (const write of [false, true]) {
      control.register(`plugin.${view ? 'view.' : ''}preferences.${write ? 'set' : 'get'}`, {
        kind: write ? 'command' : 'query',
        validate: raw => {
          const input = pluginRecord(raw)
          const key = view ? 'viewId' : 'pluginId'
          if (
            Object.keys(input).some(
              field => ![key, ...(write ? ['key', 'value'] : [])].includes(field),
            )
          ) {
            throw new Error('Unexpected preference argument.')
          }
          return {
            id: pluginString(input[key], key, 200),
            key: write ? pluginString(input.key, 'preference key', 80) : '',
            value: input.value,
          }
        },
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
      })
    }
  }
}
