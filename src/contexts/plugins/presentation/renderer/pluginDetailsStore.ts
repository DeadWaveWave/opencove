import type { PluginDetails } from '../../domain/pluginRuntimeTypes'
import type { PluginManifest } from '../../domain/pluginTypes'
import { pluginErrorMessage } from './pluginErrorMessage'

export interface PluginDetailSnapshot {
  detail: PluginDetails | null
  error: string | null
}
export interface PluginDetailEntry {
  getSnapshot: () => PluginDetailSnapshot
  subscribe: (listener: () => void) => () => void
  load: (plugin: PluginManifest, force?: boolean) => Promise<void>
}
export const EMPTY_PLUGIN_DETAIL: PluginDetailSnapshot = { detail: null, error: null }

/** Active views retain their revision; inactive documentation is a small, disposable cache. */
export function createPluginDetailsStore(
  fetchDetail: (pluginId: string) => Promise<PluginDetails>,
  maxInactive = 6,
) {
  interface Entry extends PluginDetailEntry {
    key: string
    plugin: PluginManifest
    listeners: Set<() => void>
    touched: number
    snapshot: PluginDetailSnapshot
    signature: string | null
    pending: Promise<void> | null
    pendingSignature: string | null
    reloadRequested: boolean
  }
  const entries = new Map<string, Entry>()
  const latest = new Map<string, string>()
  let clock = 0
  const signature = (plugin: PluginManifest) =>
    JSON.stringify([plugin.runtimeGeneration, plugin.status, plugin.enabled, plugin.error])

  function prune(): void {
    const inactive = [...entries.values()].filter(entry => entry.listeners.size === 0)
    for (const entry of inactive) {
      if (latest.get(entry.plugin.id) !== entry.key) {
        entries.delete(entry.key)
      }
    }
    const retained = inactive
      .filter(entry => entries.has(entry.key))
      .sort((a, b) => b.touched - a.touched)
    for (const entry of retained.slice(maxInactive)) {
      entries.delete(entry.key)
    }
    for (const [id, key] of latest) {
      if (!entries.has(key)) {
        latest.delete(id)
      }
    }
  }

  function publish(entry: Entry, snapshot: PluginDetailSnapshot): void {
    if (entries.get(entry.key) !== entry) {
      return
    }
    entry.snapshot = snapshot
    entry.listeners.forEach(listener => listener())
  }

  function load(entry: Entry, plugin: PluginManifest, force: boolean): Promise<void> {
    entry.plugin = plugin
    entry.touched = ++clock
    const requestedSignature = signature(plugin)
    if (entry.pending) {
      entry.reloadRequested ||= force || requestedSignature !== entry.pendingSignature
      return entry.pending
    }
    if (!force && entry.snapshot.detail && requestedSignature === entry.signature) {
      return Promise.resolve()
    }
    entry.pendingSignature = requestedSignature
    entry.pending = Promise.resolve()
      .then(() => fetchDetail(plugin.id))
      .then(detail => {
        // A lifecycle transition may have replaced the source while this request was in flight.
        if (
          detail.plugin.id !== plugin.id ||
          (plugin.revision && detail.plugin.revision !== plugin.revision) ||
          detail.plugin.runtimeGeneration !== plugin.runtimeGeneration ||
          entry.plugin.runtimeGeneration !== plugin.runtimeGeneration
        ) {
          return
        }
        entry.signature = requestedSignature
        publish(entry, { detail, error: null })
      })
      .catch((error: unknown) => {
        if (entry.plugin.runtimeGeneration !== plugin.runtimeGeneration) {
          return
        }
        publish(entry, { detail: entry.snapshot.detail, error: pluginErrorMessage(error) })
      })
      .finally(() => {
        entry.pending = null
        entry.pendingSignature = null
        if (entry.reloadRequested && entries.get(entry.key) === entry && entry.listeners.size > 0) {
          entry.reloadRequested = false
          void load(entry, entry.plugin, true)
        }
        prune()
      })
    return entry.pending
  }

  return {
    get(plugin: PluginManifest): PluginDetailEntry {
      const key = `${plugin.id}:${plugin.revision ?? plugin.version}`
      let entry = entries.get(key)
      if (!entry) {
        const created: Entry = {
          key,
          plugin,
          listeners: new Set(),
          touched: ++clock,
          snapshot: EMPTY_PLUGIN_DETAIL,
          signature: null,
          pending: null,
          pendingSignature: null,
          reloadRequested: false,
          getSnapshot: () => created.snapshot,
          subscribe: listener => {
            created.listeners.add(listener)
            return () => {
              created.listeners.delete(listener)
              queueMicrotask(prune)
            }
          },
          load: (next, force = false) => load(created, next, force),
        }
        entry = created
        entries.set(key, entry)
      }
      entry.plugin = plugin
      entry.touched = ++clock
      latest.set(plugin.id, key)
      prune()
      return entry
    },
    refresh(pluginId: string): void {
      for (const entry of entries.values()) {
        if (entry.plugin.id === pluginId && entry.listeners.size > 0) {
          void load(entry, entry.plugin, true)
        }
      }
    },
  }
}
