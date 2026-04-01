import { createServer } from 'node:http'
import { once } from 'node:events'
import { expect, test, type ElectronApplication } from '@playwright/test'
import { clearAndSeedWorkspace, launchApp, readCanvasViewport } from './workspace-canvas.helpers'

interface WebsiteRuntimeState {
  lifecycle: string
  bounds: {
    x: number
    y: number
    width: number
    height: number
  } | null
  zoomFactor: number | null
  innerWidth: number | null
}

async function readWebsiteRuntimeState(
  electronApp: ElectronApplication,
  nodeId: string,
): Promise<WebsiteRuntimeState | null> {
  return await electronApp.evaluate(async ({ BrowserWindow }, targetNodeId) => {
    const win = BrowserWindow.getAllWindows()[0]
    const manager = win.__opencoveWebsiteWindowManager
    const runtime = manager?.runtimeByNodeId.get(targetNodeId) ?? null
    if (!runtime || !runtime.view || runtime.view.webContents.isDestroyed()) {
      return runtime
        ? {
            lifecycle: runtime.lifecycle,
            bounds: runtime.bounds,
            zoomFactor: null,
            innerWidth: null,
          }
        : null
    }

    const innerWidth = await runtime.view.webContents.executeJavaScript('window.innerWidth')
    return {
      lifecycle: runtime.lifecycle,
      bounds: runtime.view.getBounds(),
      zoomFactor: runtime.view.webContents.getZoomFactor(),
      innerWidth: typeof innerWidth === 'number' ? innerWidth : null,
    }
  }, nodeId)
}

test.describe('Workspace Canvas - Website Window', () => {
  test('keeps website content at 100% page zoom while canvas zoom changes', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      response.end(`<!doctype html>
        <html>
          <body style="margin:0;background:#fff;font:600 36px -apple-system;">
            <div style="padding:24px 28px;border-bottom:1px solid #d8e0f0;display:flex;gap:16px;align-items:center;">
              <div style="width:84px;height:84px;border-radius:24px;background:linear-gradient(135deg,#5aa8ff,#7d6bff)"></div>
              <div>
                <div>Scale Marker</div>
                <div style="font-size:18px;font-weight:500;color:#52637d;">Website content should stay at 100% zoom.</div>
              </div>
            </div>
            <div style="height:1200px;padding:28px;display:grid;grid-template-columns:repeat(3,1fr);gap:24px;background:#f5f8ff;">
              ${Array.from({ length: 12 }, (_item, index) => {
                return `<div style="height:160px;border-radius:24px;background:#fff;box-shadow:0 12px 30px rgba(40,60,100,.12);display:flex;align-items:center;justify-content:center;">${index + 1}</div>`
              }).join('')}
            </div>
          </body>
        </html>`)
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
      await clearAndSeedWorkspace(window, [
        {
          id: 'website-zoom-node',
          title: 'website-zoom-node',
          position: { x: 320, y: 120 },
          width: 980,
          height: 680,
          kind: 'website',
          task: {
            url: websiteUrl,
            pinned: false,
            sessionMode: 'shared',
            profileId: null,
          },
        },
      ])

      const websiteNode = window.locator('.website-node').first()
      await expect(websiteNode).toBeVisible()

      const viewport = websiteNode.locator('.website-node__viewport')
      await expect(viewport).toHaveCSS('border-top-left-radius', '0px')
      await expect(viewport).toHaveCSS('border-top-right-radius', '0px')

      await websiteNode.click({ position: { x: 320, y: 180 } })

      await expect
        .poll(async () => {
          return await readWebsiteRuntimeState(electronApp, 'website-zoom-node')
        })
        .toMatchObject({
          lifecycle: 'active',
          zoomFactor: 1,
        })

      const beforeCanvasZoom = await readCanvasViewport(window)
      const before = await readWebsiteRuntimeState(electronApp, 'website-zoom-node')
      expect(before?.bounds).toBeTruthy()
      expect(before?.zoomFactor).toBe(1)
      expect(before?.innerWidth).toBe(before?.bounds?.width ?? null)

      const zoomInButton = window.locator('.react-flow__controls-zoomin')
      await expect(zoomInButton).toBeVisible()
      await zoomInButton.click()
      await zoomInButton.click()

      await expect
        .poll(async () => {
          return await readCanvasViewport(window)
        })
        .not.toEqual(beforeCanvasZoom)

      await expect
        .poll(async () => {
          return (
            (await readWebsiteRuntimeState(electronApp, 'website-zoom-node'))?.zoomFactor ?? null
          )
        })
        .toBe(1)

      await expect
        .poll(async () => {
          return (
            (await readWebsiteRuntimeState(electronApp, 'website-zoom-node'))?.bounds?.width ?? null
          )
        })
        .not.toBe(before?.bounds?.width ?? null)

      const after = await readWebsiteRuntimeState(electronApp, 'website-zoom-node')
      expect(after?.lifecycle).toBe('active')
      expect(after?.bounds).toBeTruthy()
      expect(after?.zoomFactor).toBe(1)
      expect(after?.innerWidth).toBe(after?.bounds?.width ?? null)
      expect(after?.bounds?.width).not.toBe(before?.bounds?.width)
    } finally {
      server.close()
      await electronApp.close()
    }
  })
})
