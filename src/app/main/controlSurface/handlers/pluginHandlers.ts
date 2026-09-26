import type { ControlSurface } from '../controlSurface'
import { createBuiltinPluginRegistry } from '@contexts/plugins/application/pluginRegistry'

export function registerPluginHandlers(controlSurface: ControlSurface): void {
  const registry = createBuiltinPluginRegistry()
  controlSurface.register('plugin.list', {
    kind: 'query',
    validate: () => null,
    handle: async () => ({
      plugins: registry.list().map(plugin => ({
        id: plugin.id,
        version: plugin.version,
        displayName: plugin.displayName,
        description: plugin.description,
        nodeKinds: [...plugin.nodeKinds],
        actionBar: plugin.actionBar,
        contextMenu: plugin.contextMenu,
      })),
    }),
    defaultErrorCode: 'common.invalid_input',
  })
}
