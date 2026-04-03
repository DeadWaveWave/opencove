import { create } from 'zustand'
import type { WebsiteWindowEventPayload, WebsiteWindowLifecycle } from '@shared/contracts/dto'

export type WebsiteWindowRuntimeState = {
  lifecycle: WebsiteWindowLifecycle
  isOccluded: boolean
  url: string | null
  title: string | null
  isLoading: boolean
  canGoBack: boolean
  canGoForward: boolean
  snapshotDataUrl: string | null
  errorMessage: string | null
}

type WebsiteWindowStoreState = {
  runtimeByNodeId: Record<string, WebsiteWindowRuntimeState | undefined>
  applyEvent: (event: WebsiteWindowEventPayload) => void
  clearNode: (nodeId: string) => void
  clearAll: () => void
}

function resolveDefaultRuntime(): WebsiteWindowRuntimeState {
  return {
    lifecycle: 'cold',
    isOccluded: false,
    url: null,
    title: null,
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
    snapshotDataUrl: null,
    errorMessage: null,
  }
}

export const useWebsiteWindowStore = create<WebsiteWindowStoreState>(set => ({
  runtimeByNodeId: {},
  applyEvent: event => {
    set(state => {
      const runtimeByNodeId = { ...state.runtimeByNodeId }

      if (event.type === 'closed') {
        delete runtimeByNodeId[event.nodeId]
        return { runtimeByNodeId }
      }

      if (event.type === 'open-url') {
        return state
      }

      const previous = runtimeByNodeId[event.nodeId] ?? resolveDefaultRuntime()
      const next: WebsiteWindowRuntimeState =
        event.type === 'state'
          ? {
              ...previous,
              lifecycle: event.lifecycle,
              isOccluded: event.isOccluded,
              url: event.url,
              title: event.title,
              isLoading: event.isLoading,
              canGoBack: event.canGoBack,
              canGoForward: event.canGoForward,
              snapshotDataUrl: previous.snapshotDataUrl,
              errorMessage: null,
            }
          : event.type === 'snapshot'
            ? { ...previous, snapshotDataUrl: event.dataUrl }
            : { ...previous, errorMessage: event.message }

      runtimeByNodeId[event.nodeId] = next
      return { runtimeByNodeId }
    })
  },
  clearNode: nodeId => {
    const normalized = nodeId.trim()
    if (normalized.length === 0) {
      return
    }

    set(state => {
      if (!state.runtimeByNodeId[normalized]) {
        return state
      }

      const runtimeByNodeId = { ...state.runtimeByNodeId }
      delete runtimeByNodeId[normalized]
      return { runtimeByNodeId }
    })
  },
  clearAll: () => {
    set({ runtimeByNodeId: {} })
  },
}))
