import { PIXEL_EFFECTS_ENABLED } from './workspace-canvas.pixel-effects.helpers'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { expect, test, type ElectronApplication } from '@playwright/test'
import { clearAndSeedWorkspace, launchApp } from './workspace-canvas.helpers'
import {
  closeWebsiteTestServer,
  enableWebsiteWindowPolicy,
  readWebsiteRuntimeState,
} from './workspace-canvas.website-window.shared'

const nodeId = 'pixel-native-reveal'

async function nativeVisible(app: ElectronApplication) {
  return await app.evaluate(({ BrowserWindow }, id) => {
    const win = BrowserWindow.getAllWindows()[0]
    const runtime = win.__opencoveWebsiteWindowManager?.runtimeByNodeId.get(id)
    return runtime?.hostView?.getVisible() ?? false
  }, nodeId)
}

test('clips native website reveal without shrinking or reloading the browser viewport', async ({
  browserName,
}, testInfo) => {
  void browserName
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    response.end(
      '<!doctype html><body style="margin:0;background:#164f70;color:#e6f6ff;font:24px monospace">Native browser reveal</body>',
    )
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  server.unref()
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Missing native reveal fixture address')
  }
  let app: ElectronApplication | null = null
  try {
    const launched = await launchApp()
    app = launched.electronApp
    const window = launched.window
    await clearAndSeedWorkspace(
      window,
      [
        {
          id: nodeId,
          kind: 'website',
          title: 'Native reveal',
          position: { x: 260, y: 150 },
          width: 560,
          height: 400,
          task: {
            url: `http://127.0.0.1:${address.port}`,
            pinned: false,
            sessionMode: 'shared',
            profileId: null,
          },
        },
      ],
      {
        settings: {
          uiTheme: 'pixel',
          ...PIXEL_EFFECTS_ENABLED,
          websiteWindowPolicy: { enabled: true },
        },
      },
    )
    await enableWebsiteWindowPolicy(window)
    const node = window.locator(`.react-flow__node[data-id="${nodeId}"]`)
    await node.locator('.website-node').click({ position: { x: 160, y: 180 }, noWaitAfter: true })
    await expect
      .poll(() => readWebsiteRuntimeState(app!, nodeId))
      .toMatchObject({ lifecycle: 'active' })
    await expect.poll(() => nativeVisible(app!)).toBe(true)
    const before = await readWebsiteRuntimeState(app, nodeId)
    expect(before?.viewBounds?.width).toBeGreaterThan(0)

    // Drive the same view-only frontier consumed by the native clipping boundary.
    // Page geometry stays authoritative while the host reveals just the traversed region.
    await node.evaluate(element =>
      (element as HTMLElement).style.setProperty('--cove-pixel-reveal-front', '0.5'),
    )
    await expect
      .poll(async () => (await readWebsiteRuntimeState(app!, nodeId))?.hostBounds?.width)
      .toBeLessThan((before?.hostBounds?.width ?? 0) * 0.7)
    const halfway = await readWebsiteRuntimeState(app, nodeId)
    expect(halfway?.viewBounds?.width).toBe(before?.viewBounds?.width)
    expect(halfway?.innerWidth).toBe(before?.innerWidth)
    expect(halfway?.zoomFactor).toBe(before?.zoomFactor)
    await testInfo.attach('native-pixel-prefix', {
      body: await window.screenshot(),
      contentType: 'image/png',
    })

    await node.evaluate(element =>
      (element as HTMLElement).style.setProperty('--cove-pixel-reveal-front', '0'),
    )
    await expect.poll(() => nativeVisible(app!)).toBe(false)
    await node.evaluate(element =>
      (element as HTMLElement).style.removeProperty('--cove-pixel-reveal-front'),
    )
    await expect.poll(() => nativeVisible(app!)).toBe(true)
    await expect
      .poll(async () => (await readWebsiteRuntimeState(app!, nodeId))?.hostBounds?.width)
      .toBe(before?.hostBounds?.width)
    const after = await readWebsiteRuntimeState(app, nodeId)
    expect(after?.viewBounds?.width).toBe(before?.viewBounds?.width)
    expect(after?.innerWidth).toBe(before?.innerWidth)
  } finally {
    await app?.close()
    await closeWebsiteTestServer(server)
  }
})
