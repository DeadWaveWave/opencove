import { pluginErrorMessage } from './pluginErrorMessage'
import type { PluginManifest } from '../../domain/pluginTypes'

export interface PluginCatalogSnapshot {
  plugins: readonly PluginManifest[]
  error: string | null
}

/** Backend installation metadata only; user enablement remains in application settings. */
export function createPluginCatalogStore(
  initial: readonly PluginManifest[],
  load: () => Promise<readonly PluginManifest[]>,
) {
  let snapshot: PluginCatalogSnapshot = { plugins: initial, error: null }
  let generation = 0
  let pending: Promise<void> | null = null
  const listeners = new Set<() => void>()

  function publish(plugins: readonly PluginManifest[], error: string | null): void {
    const previous = new Map(snapshot.plugins.map(plugin => [plugin.id, plugin]))
    const stablePlugins = plugins.map(plugin => {
      const old = previous.get(plugin.id)
      return old && JSON.stringify(old) === JSON.stringify(plugin) ? old : plugin
    })
    if (
      snapshot.error === error &&
      snapshot.plugins.length === stablePlugins.length &&
      stablePlugins.every((plugin, index) => plugin === snapshot.plugins[index])
    ) {
      return
    }
    snapshot = { plugins: stablePlugins, error }
    listeners.forEach(listener => listener())
  }

  function refresh(): Promise<void> {
    if (pending) {
      return pending
    }
    const request = ++generation
    pending = Promise.resolve()
      .then(load)
      .then(plugins => {
        if (generation === request) {
          publish(plugins, null)
        }
      })
      .catch((error: unknown) => {
        if (generation === request) {
          publish(snapshot.plugins, pluginErrorMessage(error))
        }
      })
      .finally(() => {
        if (generation === request) {
          pending = null
        }
      })
    return pending
  }

  return {
    getSnapshot: (): PluginCatalogSnapshot => snapshot,
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    refresh,
    invalidate(): void {
      generation += 1
      pending = null
    },
  }
}
