import { createServer } from 'node:http'
import { once } from 'node:events'
import { expect, test, type ElectronApplication } from '@playwright/test'
import { clearAndSeedWorkspace, launchApp, readCanvasViewport } from './workspace-canvas.helpers'
import {
  closeWebsiteTestServer,
  enableWebsiteWindowPolicy,
} from './workspace-canvas.website-window.shared'

const WEBSITE_MIN_LIVE_CANVAS_ZOOM = 0.25

interface WebsiteRuntimeState {
  lifecycle: string
  snapshotDocumentReady: boolean
  hasSnapshot: boolean
  snapshotCaptureInFlight: boolean
}

async function readWebsiteRuntimeState(
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

    return {
      lifecycle: runtime.lifecycle,
      snapshotDocumentReady: runtime.snapshotDocumentReady,
      hasSnapshot:
        typeof runtime.snapshotDataUrl === 'string' && runtime.snapshotDataUrl.length > 0,
      snapshotCaptureInFlight: runtime.snapshotCaptureInFlight,
    }
  }, nodeId)
}

async function prepareIdleWebsiteSnapshot(electronApp: ElectronApplication): Promise<void> {
  const observation = await electronApp.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    const runtime = win.__opencoveWebsiteWindowManager?.runtimeByNodeId.get('website-freeze-node')
    if (!runtime?.view) {
      throw new Error('Website view unavailable')
    }
    const contents = runtime.view.webContents
    const debuggerApi = contents.debugger
    const alreadyAttached = debuggerApi.isAttached()
    if (!alreadyAttached) {
      debuggerApi.attach('1.3')
    }

    let paints = 0
    let lastPaintAt = 0
    let idleTimer: ReturnType<typeof setTimeout> | undefined
    let deadline: ReturnType<typeof setTimeout> | undefined
    let onPaint: () => void = () => {}
    const idle = new Promise<void>((resolve, reject) => {
      deadline = setTimeout(() => reject(new Error('Website did not become idle')), 15_000)
      onPaint = () => {
        paints += 1
        lastPaintAt = Date.now()
        clearTimeout(idleTimer)
        idleTimer = setTimeout(resolve, 5_000)
      }
    })
    const onMessage = (_event: Electron.Event, method: string) => {
      if (method === 'LayerTree.layerPainted') {
        onPaint()
      }
    }
    debuggerApi.on('message', onMessage)

    try {
      await debuggerApi.sendCommand('LayerTree.enable')
      // Positive control: the observer must detect a real paint before measuring idle.
      await contents.executeJavaScript("document.body.style.background = '#123456'")
      await idle
      const quietMs = Date.now() - lastPaintAt
      const captureInFlight = runtime.snapshotCaptureInFlight
      // Startup already requests a snapshot. Require the later idle request to create
      // a fresh image instead of letting the assertion pass on that cached image.
      runtime.snapshotDataUrl = null
      return { paints, quietMs, captureInFlight }
    } finally {
      clearTimeout(idleTimer)
      clearTimeout(deadline)
      debuggerApi.removeListener('message', onMessage)
      await debuggerApi.sendCommand('LayerTree.disable')
      if (!alreadyAttached) {
        debuggerApi.detach()
      }
    }
  })
  expect(observation.paints).toBeGreaterThan(0)
  expect(observation.quietMs).toBeGreaterThanOrEqual(5_000)
  expect(observation.captureInFlight).toBe(false)
}

test.describe('Workspace Canvas - Website Window', () => {
  test('freezes website rendering during continuous canvas zoom', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      response.end(
        `<!doctype html><html><body style="margin:0;background:#fff;font:600 24px -apple-system;">freeze-test</body></html>`,
      )
    })

    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    server.unref()
    const address = server.address()
    if (!address || typeof address === 'string') {
      throw new Error('Failed to resolve website test server address')
    }

    const websiteUrl = `http://127.0.0.1:${address.port}`
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'website-freeze-node',
            title: 'website-freeze-node',
            position: { x: 320, y: 120 },
            width: 920,
            height: 660,
            kind: 'website',
            task: {
              url: websiteUrl,
              pinned: false,
              sessionMode: 'shared',
              profileId: null,
            },
          },
        ],
        {
          settings: {
            websiteWindowPolicy: { enabled: true },
          },
        },
      )

      const websiteNode = window.locator('.website-node').first()
      await expect(websiteNode).toBeVisible()
      await enableWebsiteWindowPolicy(window)
      await websiteNode.click({ position: { x: 320, y: 180 }, noWaitAfter: true })
      await expect
        .poll(async () => {
          return await readWebsiteRuntimeState(electronApp, 'website-freeze-node')
        })
        .toMatchObject({
          lifecycle: 'active',
          snapshotDocumentReady: true,
          hasSnapshot: true,
          snapshotCaptureInFlight: false,
        })

      await prepareIdleWebsiteSnapshot(electronApp)

      await window.evaluate(() => {
        window.opencoveApi.websiteWindow.captureSnapshot({
          nodeId: 'website-freeze-node',
          quality: 60,
        })
      })

      await expect
        .poll(async () => {
          return (
            (await readWebsiteRuntimeState(electronApp, 'website-freeze-node'))?.hasSnapshot ??
            false
          )
        })
        .toBe(true)

      await window.evaluate(() => {
        const button = document.querySelector(
          '.react-flow__controls-zoomout',
        ) as HTMLButtonElement | null
        if (!button) {
          return
        }

        return new Promise<void>(resolve => {
          let count = 0
          const tick = () => {
            button.click()
            count += 1
            if (count >= 9) {
              resolve()
              return
            }

            window.setTimeout(tick, 20)
          }

          tick()
        })
      })

      const snapshot = websiteNode.locator('.website-node__snapshot')
      await expect(snapshot).toBeVisible()

      const canvasViewport = await readCanvasViewport(window)
      await window.waitForTimeout(450)
      if (canvasViewport.zoom <= WEBSITE_MIN_LIVE_CANVAS_ZOOM + 0.001) {
        await expect(snapshot).toBeVisible()
      } else {
        await expect(snapshot).toBeHidden()
      }
    } finally {
      await electronApp.close()
      await closeWebsiteTestServer(server)
    }
  })
})
