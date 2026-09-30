import { useSyncExternalStore } from 'react'

// Live content titles are presentation, not user-pinned workspace metadata.
const titles = new Map<string, string>()
const subscribers = new Map<string, Set<() => void>>()

export function setPluginWindowTitle(nodeId: string, title: string | null): void {
  if ((titles.get(nodeId) ?? null) === title) {
    return
  }
  if (title === null) {
    titles.delete(nodeId)
  } else {
    titles.set(nodeId, title)
  }
  subscribers.get(nodeId)?.forEach(notify => notify())
}

export function usePluginWindowTitle(nodeId: string): string | null {
  return useSyncExternalStore(
    notify => {
      if (!nodeId) {
        return () => {}
      }
      const listeners = subscribers.get(nodeId) ?? new Set()
      listeners.add(notify)
      subscribers.set(nodeId, listeners)
      return () => {
        listeners.delete(notify)
        if (!listeners.size) {
          subscribers.delete(nodeId)
        }
      }
    },
    () => titles.get(nodeId) ?? null,
    () => null,
  )
}
