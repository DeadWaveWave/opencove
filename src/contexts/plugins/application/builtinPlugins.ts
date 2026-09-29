import type { PluginManifest } from '../domain/pluginTypes'

export const BUILTIN_PLUGIN_MANIFESTS: readonly PluginManifest[] = [
  {
    id: 'git-board',
    version: '0.1.0',
    displayName: 'Git Board',
    description: 'Git status and a vertical commit graph for the current Space.',
    icon: { type: 'builtin', name: 'git-branch' },
    nodeKinds: ['git-board'],
    actionBar: true,
    contextMenu: true,
  },
]

export function getBuiltinPluginManifest(pluginId: string): PluginManifest | null {
  return BUILTIN_PLUGIN_MANIFESTS.find(plugin => plugin.id === pluginId) ?? null
}
