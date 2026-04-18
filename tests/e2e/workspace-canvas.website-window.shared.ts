import { once } from 'node:events'
import type { Server } from 'node:http'
import type { ElectronApplication, Page } from '@playwright/test'

const WEBSITE_WINDOW_TEST_POLICY = {
  enabled: true,
  maxActiveCount: 1,
  discardAfterMinutes: 20,
  keepAliveHosts: [],
} as const

interface WebsiteRuntimeState {
  lifecycle: string
  viewBounds: {
    x: number
    y: number
    width: number
    height: number
  } | null
  hostBounds: {
    x: number
    y: number
    width: number
    height: number
  } | null
  zoomFactor: number | null
  innerWidth: number | null
  hasSnapshot: boolean
}

export async function readWebsiteRuntimeState(
  electronApp: ElectronApplication,
  nodeId: string,
): Promise<WebsiteRuntimeState | null> {
  return await electronApp.evaluate(async ({ BrowserWindow }, targetNodeId) => {
    const win = BrowserWindow.getAllWindows()[0]
    const manager = win.__opencoveWebsiteWindowManager
    const runtime = manager?.runtimeByNodeId.get(targetNodeId) ?? null
    if (!runtime) {
      return null
    }

    const hostBounds = runtime.hostView ? runtime.hostView.getBounds() : null
    if (!runtime.view || runtime.view.webContents.isDestroyed()) {
      return runtime
        ? {
            lifecycle: runtime.lifecycle,
            viewBounds: runtime.bounds,
            hostBounds,
            zoomFactor: null,
            innerWidth: null,
            hasSnapshot:
              typeof runtime.snapshotDataUrl === 'string' && runtime.snapshotDataUrl.length > 0,
          }
        : null
    }

    const innerWidth = await runtime.view.webContents.executeJavaScript('window.innerWidth')
    return {
      lifecycle: runtime.lifecycle,
      viewBounds: runtime.view.getBounds(),
      hostBounds,
      zoomFactor: runtime.view.webContents.getZoomFactor(),
      innerWidth: typeof innerWidth === 'number' ? innerWidth : null,
      hasSnapshot:
        typeof runtime.snapshotDataUrl === 'string' && runtime.snapshotDataUrl.length > 0,
    }
  }, nodeId)
}

export async function enableWebsiteWindowPolicy(window: Page): Promise<void> {
  await window.evaluate(async policy => {
    const api = window.opencoveApi?.websiteWindow
    if (!api || typeof api.configurePolicy !== 'function') {
      throw new Error('Website window API unavailable')
    }

    await api.configurePolicy({ policy })
  }, WEBSITE_WINDOW_TEST_POLICY)
}

export async function closeWebsiteTestServer(server: Server): Promise<void> {
  if (!server.listening) {
    return
  }

  try {
    ;(server as unknown as { closeIdleConnections?: () => void }).closeIdleConnections?.()
    ;(server as unknown as { closeAllConnections?: () => void }).closeAllConnections?.()
  } catch {
    // Best-effort: the server should still close once Electron tears down its sockets.
  }

  try {
    server.close()
  } catch {
    return
  }

  await Promise.race([
    once(server, 'close').then(() => undefined),
    new Promise<void>(resolve => {
      setTimeout(resolve, 2_000)
    }),
  ])
}
