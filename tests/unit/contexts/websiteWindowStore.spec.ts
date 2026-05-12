import { afterEach, describe, expect, it } from 'vitest'
import { useWebsiteWindowStore } from '../../../src/contexts/workspace/presentation/renderer/store/useWebsiteWindowStore'

afterEach(() => {
  useWebsiteWindowStore.getState().clearAll()
})

describe('useWebsiteWindowStore', () => {
  it('applies state events with favicon metadata', () => {
    useWebsiteWindowStore.getState().applyEvent({
      type: 'state',
      nodeId: 'web-1',
      lifecycle: 'active',
      isOccluded: false,
      url: 'https://example.test/',
      title: 'Example',
      isLoading: false,
      canGoBack: true,
      canGoForward: false,
      faviconUrl: 'https://example.test/favicon.ico',
    })

    expect(useWebsiteWindowStore.getState().runtimeByNodeId['web-1']).toMatchObject({
      lifecycle: 'active',
      url: 'https://example.test/',
      title: 'Example',
      canGoBack: true,
      faviconUrl: 'https://example.test/favicon.ico',
    })
  })

  it('stores find, download and permission request events per node', () => {
    const store = useWebsiteWindowStore.getState()
    store.applyEvent({
      type: 'find-result',
      nodeId: 'web-1',
      requestId: 1,
      activeMatchOrdinal: 2,
      matches: 5,
      finalUpdate: true,
    })
    store.applyEvent({
      type: 'find-request',
      nodeId: 'web-1',
      requestId: 42,
    })
    store.applyEvent({
      type: 'download',
      nodeId: 'web-1',
      downloadId: 'download-1',
      url: 'https://example.test/file.zip',
      filename: 'file.zip',
      receivedBytes: 4,
      totalBytes: 10,
      state: 'progressing',
      savePath: null,
      error: null,
    })
    store.applyEvent({
      type: 'permission-request',
      nodeId: 'web-1',
      requestId: 'permission-1',
      origin: 'https://example.test',
      permission: 'media',
    })

    expect(useWebsiteWindowStore.getState().runtimeByNodeId['web-1']).toMatchObject({
      findResult: { matches: 5, activeMatchOrdinal: 2 },
      findRequestId: 42,
      downloads: [{ downloadId: 'download-1', filename: 'file.zip' }],
      permissionRequests: [{ requestId: 'permission-1', permission: 'media' }],
    })
  })

  it('ignores node-less download events and clears closed nodes', () => {
    const store = useWebsiteWindowStore.getState()
    store.applyEvent({
      type: 'download',
      nodeId: null,
      downloadId: 'download-1',
      url: 'https://example.test/file.zip',
      filename: 'file.zip',
      receivedBytes: 4,
      totalBytes: 10,
      state: 'progressing',
      savePath: null,
      error: null,
    })
    expect(useWebsiteWindowStore.getState().runtimeByNodeId).toEqual({})

    store.applyEvent({
      type: 'state',
      nodeId: 'web-1',
      lifecycle: 'active',
      isOccluded: false,
      url: null,
      title: null,
      isLoading: false,
      canGoBack: false,
      canGoForward: false,
      faviconUrl: null,
    })
    store.applyEvent({ type: 'closed', nodeId: 'web-1' })
    expect(useWebsiteWindowStore.getState().runtimeByNodeId).toEqual({})
  })
})
