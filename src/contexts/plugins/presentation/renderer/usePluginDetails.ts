import { useEffect, useSyncExternalStore } from 'react'
import type { PluginDetails } from '../../domain/pluginRuntimeTypes'
import type { PluginManifest } from '../../domain/pluginTypes'
import {
  createPluginDetailsStore,
  EMPTY_PLUGIN_DETAIL,
  type PluginDetailSnapshot,
} from './pluginDetailsStore'

const store = createPluginDetailsStore(
  async pluginId =>
    await window.opencoveApi.controlSurface.invoke<PluginDetails>({
      kind: 'query',
      id: 'plugin.details',
      payload: { pluginId },
    }),
)
const noSubscribe = (): (() => void) => () => undefined
const emptySnapshot = (): PluginDetailSnapshot => EMPTY_PLUGIN_DETAIL

/** Details/assets share requests. Runtime status changes also refresh current diagnostics. */
export function usePluginDetails(plugin: PluginManifest | null): PluginDetailSnapshot {
  const entry = plugin?.source === 'local' ? store.get(plugin) : null
  const snapshot = useSyncExternalStore(
    entry?.subscribe ?? noSubscribe,
    entry?.getSnapshot ?? emptySnapshot,
    emptySnapshot,
  )
  useEffect(() => {
    if (entry && plugin && typeof window.opencoveApi?.controlSurface?.invoke === 'function') {
      void entry.load(plugin)
    }
  }, [entry, plugin])
  return snapshot
}

export function refreshPluginDetails(pluginId: string): void {
  store.refresh(pluginId)
}
