import { create } from 'zustand'
import type {
  WebsiteWindowDownloadEvent,
  WebsiteWindowEventPayload,
  WebsiteWindowFindResultEvent,
  WebsiteWindowLifecycle,
  WebsiteWindowPermissionRequestEvent,
} from '@shared/contracts/dto'

export type WebsiteWindowRuntimeState = {
  lifecycle: WebsiteWindowLifecycle
  isOccluded: boolean
  url: string | null
  title: string | null
  isLoading: boolean
  canGoBack: boolean
  canGoForward: boolean
  faviconUrl: string | null
  snapshotDataUrl: string | null
  errorMessage: string | null
  findResult: WebsiteWindowFindResultEvent | null
  findRequestId: number
  downloads: WebsiteWindowDownloadEvent[]
  permissionRequests: WebsiteWindowPermissionRequestEvent[]
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
    faviconUrl: null,
    snapshotDataUrl: null,
    errorMessage: null,
    findResult: null,
    findRequestId: 0,
    downloads: [],
    permissionRequests: [],
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

      if (!('nodeId' in event) || typeof event.nodeId !== 'string') {
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
              faviconUrl: event.faviconUrl,
              snapshotDataUrl: previous.snapshotDataUrl,
              errorMessage: null,
            }
          : event.type === 'snapshot'
            ? { ...previous, snapshotDataUrl: event.dataUrl }
            : event.type === 'error'
              ? { ...previous, errorMessage: event.message }
              : event.type === 'find-result'
                ? {
                    ...previous,
                    findResult: event,
                  }
                : event.type === 'find-request'
                  ? {
                      ...previous,
                      findRequestId: event.requestId,
                    }
                  : event.type === 'download'
                    ? {
                        ...previous,
                        downloads: [
                          event,
                          ...previous.downloads.filter(
                            item => item.downloadId !== event.downloadId,
                          ),
                        ].slice(0, 5),
                      }
                    : event.type === 'permission-request'
                      ? {
                          ...previous,
                          permissionRequests: [
                            event,
                            ...previous.permissionRequests.filter(
                              item => item.requestId !== event.requestId,
                            ),
                          ],
                        }
                      : previous

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
