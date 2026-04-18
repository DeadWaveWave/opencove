import { createServer } from 'node:http'
import { once } from 'node:events'
import { expect, test, type ElectronApplication } from '@playwright/test'
import {
  clearAndSeedWorkspace,
  launchApp,
  readCanvasViewport,
  readLocatorClientRect,
} from './workspace-canvas.helpers'
import {
  closeWebsiteTestServer,
  enableWebsiteWindowPolicy,
  readWebsiteRuntimeState,
} from './workspace-canvas.website-window.shared'

test.describe('Workspace Canvas - Website Window', () => {
  const edgeClipTolerancePx = 8

  test('keeps website layout stable while canvas zoom changes', async () => {
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
    server.unref()
    const address = server.address()
    if (!address || typeof address === 'string') {
      throw new Error('Failed to resolve website test server address')
    }

    const websiteUrl = `http://127.0.0.1:${address.port}`
    let electronApp: ElectronApplication | null = null

    try {
      const launched = await launchApp({ windowMode: 'offscreen' })
      electronApp = launched.electronApp
      const window = launched.window

      await clearAndSeedWorkspace(
        window,
        [
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
        ],
        {
          settings: {
            websiteWindowPolicy: { enabled: true },
          },
        },
      )

      const websiteNode = window.locator('.website-node').first()
      await expect(websiteNode).toBeVisible()

      const viewport = websiteNode.locator('.website-node__viewport')
      await expect(viewport).toHaveCSS('border-top-left-radius', '0px')
      await expect(viewport).toHaveCSS('border-top-right-radius', '0px')

      await enableWebsiteWindowPolicy(window)
      await websiteNode.click({ position: { x: 320, y: 180 }, noWaitAfter: true })

      await expect
        .poll(
          async () => {
            return await readWebsiteRuntimeState(electronApp, 'website-zoom-node')
          },
          { timeout: 30_000 },
        )
        .toMatchObject({
          lifecycle: 'active',
          zoomFactor: 1,
        })

      const beforeCanvasZoom = await readCanvasViewport(window)
      const before = await readWebsiteRuntimeState(electronApp, 'website-zoom-node')
      expect(before?.viewBounds).toBeTruthy()
      expect(before?.zoomFactor).toBe(1)
      expect(before?.innerWidth).toBe(before?.viewBounds?.width ?? null)
      const beforeLogicalWidth = before?.innerWidth ?? null

      const zoomOutButton = window.locator('.react-flow__controls-zoomout')
      await expect(zoomOutButton).toBeVisible()
      await zoomOutButton.click()
      await zoomOutButton.click()

      await expect
        .poll(async () => {
          return await readCanvasViewport(window)
        })
        .not.toEqual(beforeCanvasZoom)

      const afterCanvasZoom = await readCanvasViewport(window)
      const expectedZoomFactor = Math.round(Math.min(2, Math.max(0.1, afterCanvasZoom.zoom)) * 1000)
      const normalizedExpectedZoomFactor = expectedZoomFactor / 1000

      await expect
        .poll(async () => {
          return (
            (await readWebsiteRuntimeState(electronApp, 'website-zoom-node'))?.zoomFactor ?? null
          )
        })
        .toBe(normalizedExpectedZoomFactor)

      await expect
        .poll(async () => {
          return (
            (await readWebsiteRuntimeState(electronApp, 'website-zoom-node'))?.viewBounds?.width ??
            null
          )
        })
        .not.toBe(before?.viewBounds?.width ?? null)

      const after = await readWebsiteRuntimeState(electronApp, 'website-zoom-node')
      expect(after?.lifecycle).toBe('active')
      expect(after?.viewBounds).toBeTruthy()
      expect(after?.zoomFactor).toBe(normalizedExpectedZoomFactor)
      expect(after?.innerWidth).toBeTruthy()
      if (beforeLogicalWidth !== null && typeof after?.innerWidth === 'number') {
        expect(Math.abs(after.innerWidth - beforeLogicalWidth)).toBeLessThanOrEqual(2)
      }
      expect(after?.viewBounds?.width).not.toBe(before?.viewBounds?.width)
    } finally {
      if (electronApp) {
        await electronApp.close()
      }
      await closeWebsiteTestServer(server)
    }
  })

  test('clips website view at workspace edge without shrinking the web contents view', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      response.end(
        `<!doctype html><html><body style="margin:0;background:#fff;font:600 20px -apple-system;">edge-test</body></html>`,
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
    let electronApp: ElectronApplication | null = null

    try {
      const launched = await launchApp({ windowMode: 'offscreen' })
      electronApp = launched.electronApp
      const window = launched.window

      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'website-edge-node',
            title: 'website-edge-node',
            position: { x: 320, y: 120 },
            width: 720,
            height: 520,
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
            canvasInputMode: 'trackpad',
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
            return await readWebsiteRuntimeState(electronApp, 'website-edge-node')
          },
          { timeout: 30_000 },
        )
        .toMatchObject({
          lifecycle: 'active',
        })

      const before = await readWebsiteRuntimeState(electronApp, 'website-edge-node')
      const beforeWidth = before?.viewBounds?.width ?? null
      expect(typeof beforeWidth).toBe('number')

      const pane = window.locator('.workspace-canvas .react-flow__pane')
      await expect(pane).toBeVisible()
      const paneBox = await readLocatorClientRect(pane)

      // Wheel gestures over a node are ignored by the canvas handler; keep the cursor on an empty
      // canvas point so we always trigger panning.
      const panX = paneBox.x + paneBox.width - 48
      const panY = paneBox.y + paneBox.height * 0.5
      // Refresh activation to avoid the focus-based snapshot heuristic flipping us to warm/cold
      // mid-test on slower CI runs.
      await websiteNode.click({ position: { x: 320, y: 180 }, noWaitAfter: true })
      await window.mouse.move(panX, panY)
      await pane
        .click({ position: { x: paneBox.width - 48, y: paneBox.height * 0.5 } })
        .catch(() => undefined)

      const isClipped = async (): Promise<boolean> => {
        const state = await readWebsiteRuntimeState(electronApp, 'website-edge-node')
        if (
          typeof beforeWidth !== 'number' ||
          !state?.hostBounds ||
          !state?.viewBounds ||
          state.lifecycle !== 'active'
        ) {
          return false
        }

        const hostWidth = state.hostBounds.width
        const viewWidth = state.viewBounds.width
        const viewX = state.viewBounds.x

        return (
          hostWidth < beforeWidth - 2 &&
          viewWidth >= beforeWidth - Math.max(edgeClipTolerancePx, 24) &&
          viewWidth >= hostWidth &&
          viewX < 2
        )
      }

      const panUntilClipped = async (attemptsRemaining: number): Promise<void> => {
        if (attemptsRemaining <= 0) {
          return
        }

        if (await isClipped()) {
          return
        }

        await window.mouse.wheel(600, 0)
        await window.waitForTimeout(80)
        await panUntilClipped(attemptsRemaining - 1)
      }

      await panUntilClipped(3)

      await expect.poll(async () => await isClipped(), { timeout: 30_000 }).toBe(true)

      const after = await readWebsiteRuntimeState(electronApp, 'website-edge-node')
      expect(after?.hostBounds).toBeTruthy()
      expect(after?.viewBounds).toBeTruthy()
      if (typeof after?.hostBounds?.width === 'number' && typeof beforeWidth === 'number') {
        expect(after.hostBounds.width).toBeLessThan(beforeWidth)
      }
      if (typeof after?.viewBounds?.width === 'number' && typeof beforeWidth === 'number') {
        expect(after.viewBounds.width).toBeGreaterThanOrEqual(beforeWidth - edgeClipTolerancePx)
      }
      if (typeof after?.viewBounds?.x === 'number') {
        expect(after.viewBounds.x).toBeLessThan(0)
      }
    } finally {
      if (electronApp) {
        await electronApp.close()
      }
      await closeWebsiteTestServer(server)
    }
  })

  test('clips website view away from the app header', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      response.end(
        `<!doctype html><html><body style="margin:0;background:#fff;font:600 20px -apple-system;">header-test</body></html>`,
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
    let electronApp: ElectronApplication | null = null

    try {
      const launched = await launchApp({ windowMode: 'offscreen' })
      electronApp = launched.electronApp
      const window = launched.window

      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'website-header-node',
            title: 'website-header-node',
            position: { x: 320, y: 120 },
            width: 860,
            height: 620,
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
            canvasInputMode: 'trackpad',
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
            return await readWebsiteRuntimeState(electronApp, 'website-header-node')
          },
          { timeout: 30_000 },
        )
        .toMatchObject({
          lifecycle: 'active',
        })

      const appHeader = window.locator('.app-header')
      await expect(appHeader).toBeVisible()
      const headerBox = await appHeader.boundingBox()
      if (!headerBox) {
        throw new Error('app header bounding box unavailable')
      }

      const headerBottom = headerBox.y + headerBox.height

      const sidebar = window.locator('.workspace-sidebar')
      await expect(sidebar).toBeVisible()
      const sidebarBox = await sidebar.boundingBox()
      if (!sidebarBox) {
        throw new Error('workspace sidebar bounding box unavailable')
      }

      const sidebarRight = sidebarBox.x + sidebarBox.width

      const pane = window.locator('.workspace-canvas .react-flow__pane')
      await expect(pane).toBeVisible()
      const paneBox = await pane.boundingBox()
      if (!paneBox) {
        throw new Error('workspace pane bounding box unavailable')
      }

      await window.mouse.move(paneBox.x + paneBox.width - 40, paneBox.y + 40)
      await window.mouse.wheel(0, 1400)
      await window.mouse.wheel(0, 1400)
      await window.mouse.wheel(0, 1400)
      await window.mouse.wheel(1400, 0)
      await window.mouse.wheel(1400, 0)
      await window.mouse.wheel(1400, 0)

      await expect
        .poll(async () => {
          return await window.evaluate(() => {
            const viewport = document.querySelector('.website-node__viewport') as HTMLElement | null
            return viewport ? viewport.getBoundingClientRect().top : null
          })
        })
        .toBeLessThan(headerBottom - 8)

      await expect
        .poll(async () => {
          return await window.evaluate(() => {
            const viewport = document.querySelector('.website-node__viewport') as HTMLElement | null
            return viewport ? viewport.getBoundingClientRect().left : null
          })
        })
        .toBeLessThan(sidebarRight - 8)

      await expect
        .poll(async () => {
          const state = await readWebsiteRuntimeState(electronApp, 'website-header-node')
          return typeof state?.hostBounds?.y === 'number' ? state.hostBounds.y : null
        })
        .toBeGreaterThanOrEqual(Math.floor(headerBottom))

      await expect
        .poll(async () => {
          const state = await readWebsiteRuntimeState(electronApp, 'website-header-node')
          return typeof state?.hostBounds?.x === 'number' ? state.hostBounds.x : null
        })
        .toBeGreaterThanOrEqual(Math.floor(sidebarRight))
    } finally {
      if (electronApp) {
        await electronApp.close()
      }
      await closeWebsiteTestServer(server)
    }
  })
})
