import { useEffect, useSyncExternalStore } from 'react'
import type { PluginManifest } from '../../domain/pluginTypes'
import { refreshPluginDetails } from './usePluginDetails'
import { createPluginCatalogStore } from './pluginCatalogStore'

const store = createPluginCatalogStore([], async () => {
  const result = await window.opencoveApi.controlSurface.invoke<{ plugins: PluginManifest[] }>({
    kind: 'query',
    id: 'plugin.list',
    payload: null,
  })
  if (!result || !Array.isArray(result.plugins)) {
    throw new Error('Invalid plugin catalog response')
  }
  return result.plugins
})
let owners = 0
let stopDiscovery: (() => void) | null = null

function startDiscovery(): () => void {
  owners += 1
  if (owners === 1 && typeof window.opencoveApi?.controlSurface?.invoke === 'function') {
    const refresh = (): void => {
      void store.refresh()
    }
    const poll = window.setInterval(() => {
      if (document.visibilityState !== 'hidden') {
        refresh()
      }
    }, 3000)
    window.addEventListener('focus', refresh)
    refresh()
    stopDiscovery = () => {
      window.clearInterval(poll)
      window.removeEventListener('focus', refresh)
      store.invalidate()
    }
  }
  return () => {
    owners -= 1
    if (owners === 0) {
      stopDiscovery?.()
      stopDiscovery = null
    }
  }
}

export function getPluginManifest(pluginId: string): PluginManifest | null {
  return store.getSnapshot().plugins.find(plugin => plugin.id === pluginId) ?? null
}

/** Pure registry subscription. Identity rendering and previews must not start discovery. */
export function usePluginManifest(pluginId: string): PluginManifest | null {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  return snapshot.plugins.find(plugin => plugin.id === pluginId) ?? null
}

/** Mount once in an application surface that owns discovery (canvas or plugin settings). */
export function usePluginRegistry() {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  useEffect(startDiscovery, [])
  return snapshot
}

export function refreshPluginRegistry(): Promise<void> {
  return store.refresh()
}

export async function changeInstalledPlugin<T = void>(
  id:
    | 'plugin.setEnabled'
    | 'plugin.reload'
    | 'plugin.uninstall'
    | 'plugin.install'
    | 'plugin.git.install'
    | 'plugin.git.update'
    | 'plugin.git.apply'
    | 'plugin.rollback',
  payload: Record<string, unknown>,
): Promise<T> {
  try {
    return await window.opencoveApi.controlSurface.invoke<T>({ kind: 'command', id, payload })
  } finally {
    // Failed reloads leave the prior revision working but may add useful diagnostics.
    store.invalidate()
    await store.refresh()
    if (typeof payload.pluginId === 'string') {
      refreshPluginDetails(payload.pluginId)
    }
  }
}
