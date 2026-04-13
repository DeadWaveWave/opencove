import { createServer } from 'node:http'
import { once } from 'node:events'
import { expect, test, type ElectronApplication } from '@playwright/test'
import { clearAndSeedWorkspace, launchApp, readCanvasViewport } from './workspace-canvas.helpers'
import {
  closeWebsiteTestServer,
  enableWebsiteWindowPolicy,
  readWebsiteRuntimeState as readWebsiteViewState,
} from './workspace-canvas.website-window.shared'

interface WebsiteRuntimeState {
  lifecycle: string
  canvasZoom: number
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
      canvasZoom: runtime.canvasZoom,
    }
  }, nodeId)
}

async function readWebsiteDevicePixelRatio(
  electronApp: ElectronApplication,
  nodeId: string,
): Promise<number | null> {
  return await electronApp.evaluate(async ({ BrowserWindow }, targetNodeId) => {
    const win = BrowserWindow.getAllWindows()[0]
    const manager = win.__opencoveWebsiteWindowManager
    const runtime = manager?.runtimeByNodeId.get(targetNodeId) ?? null
    const view = runtime?.view ?? null
    if (!view) {
      return null
    }

    const wc = view.webContents
    if (!wc || wc.isDestroyed() || wc.isLoadingMainFrame()) {
      return null
    }

    try {
      const readyState = await wc.executeJavaScript('document.readyState')
      if (readyState !== 'interactive' && readyState !== 'complete') {
        return null
      }

      const dpr = await wc.executeJavaScript('window.devicePixelRatio')
      return typeof dpr === 'number' && Number.isFinite(dpr) ? dpr : null
    } catch {
      return null
    }
  }, nodeId)
}

test.describe('Workspace Canvas - Website Window', () => {
  test('keeps website devicePixelRatio stable across canvas zoom', async () => {
    test.skip(
      !!process.env.CI,
      'Flaky on GitHub Actions Linux runners; keep local coverage until website runtime readiness is stabilized.',
    )

    const server = createServer((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      response.end(
        `<!doctype html><html><body style="margin:0;background:#fff;font:600 24px -apple-system;">dpr-test</body></html>`,
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
    const { electronApp, window } = await launchApp({ windowMode: 'offscreen' })

    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'website-dpr-node',
            title: 'website-dpr-node',
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
        .poll(
          async () => {
            return await readWebsiteRuntimeState(electronApp, 'website-dpr-node')
          },
          { timeout: 30_000 },
        )
        .toMatchObject({
          lifecycle: 'active',
        })

      await expect
        .poll(
          async () => {
            const state = await readWebsiteViewState(electronApp, 'website-dpr-node')
            if (!state || state.lifecycle !== 'active') {
              return null
            }

            if (state.zoomFactor === null || state.innerWidth === null) {
              return null
            }

            return {
              zoomFactor: state.zoomFactor,
              innerWidth: state.innerWidth,
            }
          },
          { timeout: 30_000 },
        )
        .toMatchObject({
          zoomFactor: 1,
        })

      let baselineDpr: number | null = null
      await expect
        .poll(
          async () => {
            baselineDpr = await readWebsiteDevicePixelRatio(electronApp, 'website-dpr-node')
            return baselineDpr
          },
          { timeout: 30_000 },
        )
        .not.toBeNull()

      if (baselineDpr === null) {
        throw new Error('Failed to read website devicePixelRatio baseline')
      }

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
            if (count >= 4) {
              resolve()
              return
            }

            window.setTimeout(tick, 20)
          }

          tick()
        })
      })

      const canvasViewport = await readCanvasViewport(window)
      await window.waitForTimeout(450)

      await expect
        .poll(async () => {
          const state = await readWebsiteRuntimeState(electronApp, 'website-dpr-node')
          if (!state) {
            return null
          }

          return Math.round(state.canvasZoom * 1000) / 1000
        })
        .toBe(Math.round(canvasViewport.zoom * 1000) / 1000)

      let dprAfterZoom: number | null = null
      await expect
        .poll(
          async () => {
            dprAfterZoom = await readWebsiteDevicePixelRatio(electronApp, 'website-dpr-node')
            return dprAfterZoom
          },
          { timeout: 30_000 },
        )
        .not.toBeNull()

      if (dprAfterZoom === null) {
        throw new Error('Failed to read website devicePixelRatio after zoom')
      }

      expect(dprAfterZoom).toBeCloseTo(baselineDpr, 3)
    } finally {
      await electronApp.close()
      await closeWebsiteTestServer(server)
    }
  })
})
