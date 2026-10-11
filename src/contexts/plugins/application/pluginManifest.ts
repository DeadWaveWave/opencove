import type { PluginManifest } from '../domain/pluginTypes'
import { pluginRuntimeGeneration, type PluginRuntimeState } from './PluginRuntimeState'

export function installedPluginManifest(runtime: PluginRuntimeState): PluginManifest {
  const { record, error } = runtime
  const pkg = record.package
  return {
    id: pkg.id,
    version: pkg.version,
    displayName: pkg.displayName,
    description: pkg.description,
    icon: pkg.icon,
    author: pkg.author,
    source: 'local',
    nodeKinds: pkg.view ? [pkg.id] : [],
    actionBar: Boolean(pkg.view) && pkg.contributes?.actionBar !== false,
    contextMenu: Boolean(pkg.view) && pkg.contributes?.contextMenu !== false,
    revision: record.revision,
    runtimeGeneration: pluginRuntimeGeneration(runtime),
    enabled: record.enabled,
    status: error ? 'error' : record.enabled ? 'ready' : 'disabled',
    error,
    ...(pkg.view
      ? {
          view: {
            entry: pkg.view.entry,
            instances: pkg.view.instances ?? 'multiple',
            width: pkg.view.width ?? 640,
            height: pkg.view.height ?? 440,
            minWidth: pkg.view.minWidth ?? 320,
            minHeight: pkg.view.minHeight ?? 220,
          },
        }
      : {}),
    hasPreview: Boolean(pkg.preview),
    commands: pkg.contributes?.commands?.map(command => ({ ...command })) ?? [],
    skills: pkg.contributes?.skills?.map(skill => ({ ...skill })) ?? [],
    preferences: pkg.contributes?.preferences ?? [],
    themes: pkg.contributes?.themes ?? [],
    sidebar: pkg.contributes?.sidebar ?? [],
  }
}
