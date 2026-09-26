import { BUILTIN_PLUGIN_MANIFESTS } from './builtinPlugins'
import type { PluginManifest } from '../domain/pluginTypes'

export interface PluginRegistry {
  list(): readonly PluginManifest[]
  get(id: string): PluginManifest | null
}

export function createBuiltinPluginRegistry(): PluginRegistry {
  const byId = new Map(BUILTIN_PLUGIN_MANIFESTS.map(plugin => [plugin.id, plugin]))
  return {
    list: () => BUILTIN_PLUGIN_MANIFESTS,
    get: id => byId.get(id) ?? null,
  }
}
