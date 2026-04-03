import { createServer } from 'node:http'
import { once } from 'node:events'
import { expect, test, type ElectronApplication } from '@playwright/test'
import { clearAndSeedWorkspace, launchApp, readCanvasViewport } from './workspace-canvas.helpers'

const WEBSITE_MIN_LIVE_CANVAS_ZOOM = 0.25

interface WebsiteRuntimeState {
  lifecycle: string
  hasSnapshot: boolean
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
      hasSnapshot:
        typeof runtime.snapshotDataUrl === 'string' && runtime.snapshotDataUrl.length > 0,
    }
  }, nodeId)
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
      await websiteNode.click({ position: { x: 320, y: 180 } })
      await expect
        .poll(async () => {
          return await readWebsiteRuntimeState(electronApp, 'website-freeze-node')
        })
        .toMatchObject({
          lifecycle: 'active',
        })

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
      server.close()
      await electronApp.close()
    }
  })
})
