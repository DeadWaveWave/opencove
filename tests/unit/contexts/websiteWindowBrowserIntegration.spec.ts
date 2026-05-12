import type { WebContents } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { WebsiteWindowBrowserIntegration } from '../../../src/app/main/websiteWindow/websiteWindowBrowserIntegration'
import type { WebsiteWindowRuntime } from '../../../src/app/main/websiteWindow/websiteWindowRuntime'
import type { BrowserProfileStore } from '../../../src/contexts/browser/infrastructure/main/BrowserProfileStore'

function createRuntime(contents: WebContents): WebsiteWindowRuntime {
  return {
    nodeId: 'web-1',
    lifecycle: 'active',
    pinned: false,
    sessionMode: 'shared',
    profileId: null,
    desiredUrl: 'https://example.test/page',
    hostView: null,
    view: { webContents: contents },
    bounds: null,
    viewportBounds: null,
    canvasZoom: 1,
    lastActivatedAt: 0,
    canGoBack: false,
    canGoForward: false,
    isLoading: false,
    title: null,
    url: 'https://example.test/page',
    faviconUrl: null,
    snapshotDataUrl: null,
    pendingSnapshotQuality: null,
    snapshotCaptureInFlight: false,
    scrollbarCssKey: null,
    scrollbarCssSizePx: null,
    scrollbarCssVersion: 0,
    deviceMetricsDebuggerAttached: false,
    deviceMetricsScaleFactor: null,
    deviceMetricsWidth: null,
    deviceMetricsHeight: null,
    deviceMetricsVersion: 0,
    discardTimer: null,
    disposeWebContentsListeners: null,
  } as WebsiteWindowRuntime
}

describe('WebsiteWindowBrowserIntegration', () => {
  it('denies pending permission requests when the owning node closes', async () => {
    const contents = {
      isDestroyed: () => false,
    } as unknown as WebContents
    const runtime = createRuntime(contents)
    const callback = vi.fn()
    const emit = vi.fn()
    const store = {
      getPermissionDecision: vi.fn(() => null),
    } as unknown as BrowserProfileStore
    const integration = new WebsiteWindowBrowserIntegration({
      getBrowserProfileStore: async () => store,
      getRuntimes: () => [runtime],
      emit,
    })

    integration.handlePermissionRequest(contents, 'media', 'https://example.test/page', callback)
    await Promise.resolve()
    await Promise.resolve()

    expect(callback).not.toHaveBeenCalled()
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'permission-request',
        nodeId: 'web-1',
        origin: 'https://example.test',
        permission: 'media',
      }),
    )

    integration.cancelPermissionRequestsForNode('web-1')

    expect(callback).toHaveBeenCalledWith(false)
    integration.dispose()
  })
})
