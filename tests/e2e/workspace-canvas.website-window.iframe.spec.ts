import { createServer } from 'node:http'
import { once } from 'node:events'
import { expect, test, type ElectronApplication } from '@playwright/test'
import { clearAndSeedWorkspace, launchApp } from './workspace-canvas.helpers'
import { closeWebsiteTestServer } from './workspace-canvas.website-window.shared'

test.describe('Workspace Canvas - Website Window iframe mode', () => {
  test('renders iframe-mode website content through the app content security policy', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      response.end(`<!doctype html>
        <html>
          <body style="margin:0;background:#fff;font:600 28px -apple-system;">
            <main id="iframe-visible-marker">Iframe mode loaded</main>
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
            id: 'website-iframe-node',
            title: 'website-iframe-node',
            position: { x: 320, y: 120 },
            width: 860,
            height: 620,
            kind: 'website',
            task: {
              url: websiteUrl,
              pinned: false,
              sessionMode: 'shared',
              profileId: null,
              browserMode: 'iframe',
            },
          },
        ],
        {
          settings: {
            browserDefaultMode: 'iframe',
            websiteWindowPolicy: { enabled: true },
          },
        },
      )

      const iframe = window.locator('.website-node__iframe')
      await expect(iframe).toBeVisible()
      await expect(iframe).toHaveAttribute('src', websiteUrl)
      await expect(
        window.frameLocator('.website-node__iframe').locator('#iframe-visible-marker'),
      ).toHaveText('Iframe mode loaded')
    } finally {
      if (electronApp) {
        await electronApp.close()
      }
      await closeWebsiteTestServer(server)
    }
  })
})
