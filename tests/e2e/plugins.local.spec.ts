import { chromium, expect, test } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  clearAndSeedWorkspace,
  createTestUserDataDir,
  launchApp,
  removePathWithRetry,
  dragMouse,
  readLocatorClientRect,
  selectCoveOption,
} from './workspace-canvas.helpers'
import {
  actionBarId,
  capturePlugins,
  clickPluginControl,
  copyPluginFixture,
  createPluginNode,
  installPlugin,
  invokeClock,
  openLocalDetails,
  pluginCommand,
  pluginId,
  savedPluginNodes,
} from './plugins.local.helpers'

const settings = {
  language: 'en' as const,
  uiTheme: 'pixel' as const,
  focusNodeOnClick: false,
  canvasInputMode: 'mouse' as const,
  nodeCreationPixelEffectEnabled: false,
  nodeClosePixelEffectEnabled: false,
}

test.describe('Independently installed plugins', () => {
  test('loads source, preserves work across collapse and restart, and rejects failed replacement atomically', async ({
    browserName: _browserName,
  }, info) => {
    test.setTimeout(120_000)
    const source = await copyPluginFixture()
    const userDataDir = await createTestUserDataDir()
    let { electronApp, window: page } = await launchApp({ userDataDir, cleanupUserDataDir: false })
    try {
      await page.setViewportSize({ width: 1400, height: 1000 })
      await clearAndSeedWorkspace(page, [], { settings })
      await installPlugin(page, source)
      let node = await createPluginNode(page)
      const nodeId = await node.getAttribute('data-id')
      let frame = node.frameLocator('iframe')
      const startup = await invokeClock(node)
      await clickPluginControl(frame.locator('#increment'))
      await expect(frame.locator('#count')).toHaveText('1')
      await clickPluginControl(frame.locator('#increment'))
      await expect(frame.locator('#count')).toHaveText('2')
      await frame.locator('#label').fill('My persistent clock')
      await clickPluginControl(frame.locator('#save'))
      await expect(node.locator('.cove-canvas-node-window__title')).toHaveText(
        'My persistent clock',
      )
      const src = await node.locator('iframe').getAttribute('src')
      const elapsed = Number(await frame.locator('#ticks').textContent())
      await node.getByTestId('node-collapse').click()
      await expect(node.getByTestId('node-expand')).toBeVisible()
      await expect(node.locator('iframe')).toBeAttached()
      await expect
        .poll(async () => Number(await frame.locator('#ticks').textContent()))
        .toBeGreaterThan(elapsed)
      expect(await node.locator('iframe').getAttribute('src')).toBe(src)
      await node.getByTestId('node-expand').click()
      await expect(node.locator('.cove-node-presentation')).not.toHaveAttribute(
        'data-cove-collapse-motion',
      )
      expect(await invokeClock(node)).toBe(startup)
      const before = await readLocatorClientRect(node)
      const handle = await readLocatorClientRect(
        node.getByTestId('plugin-hello-clock-resizer-bottom-right'),
      )
      await dragMouse(page, {
        start: { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 },
        end: { x: handle.x + handle.width / 2 + 65, y: handle.y + handle.height / 2 + 40 },
      })
      await expect
        .poll(async () => (await readLocatorClientRect(node)).width)
        .toBeGreaterThan(before.width + 40)
      await capturePlugins(page, info, 'installed-plugin-runtime-pixel')
      await node.getByTestId('plugin-hello-clock-close').click()
      await expect(node).toHaveCount(0)
      node = await createPluginNode(page)
      await expect(node.frameLocator('iframe').locator('#count')).toHaveText('2')
      expect(await invokeClock(node)).toBe(startup)
      const restoredNodeId = await node.getAttribute('data-id')
      expect(restoredNodeId).not.toBe(nodeId)
      await expect.poll(async () => (await savedPluginNodes(page)).length).toBe(1)
      const compactHandle = await readLocatorClientRect(
        node.getByTestId('plugin-hello-clock-resizer-bottom-right'),
      )
      await dragMouse(page, {
        start: {
          x: compactHandle.x + compactHandle.width / 2,
          y: compactHandle.y + compactHandle.height / 2,
        },
        end: { x: compactHandle.x - 700, y: compactHandle.y - 700 },
      })
      await expect(node.locator('.cove-canvas-node-window')).toHaveCSS('width', '320px')
      await expect(node.locator('.cove-canvas-node-window')).toHaveCSS('height', '240px')
      await electronApp.close()
      ;({ electronApp, window: page } = await launchApp({ userDataDir, cleanupUserDataDir: false }))
      await page.setViewportSize({ width: 1400, height: 1000 })
      node = page.locator(`.workspace-main .react-flow__node[data-id="${restoredNodeId}"]`)
      frame = node.frameLocator('iframe')
      await expect(frame.locator('#count')).toHaveText('2', { timeout: 15_000 })
      await expect(node.locator('.cove-canvas-node-window')).toHaveCSS('width', '320px')
      await expect(node.locator('.cove-canvas-node-window')).toHaveCSS('height', '240px')
      expect(await invokeClock(node)).not.toBe(startup)
      await expect(node.locator('.cove-canvas-node-window__title')).toHaveText(
        'My persistent clock',
      )
      const htmlPath = join(source, 'index.html')
      await writeFile(
        htmlPath,
        (await readFile(htmlPath, 'utf8')).replace(
          '</main>',
          '<p id="source-version">Source revision two</p></main>',
        ),
      )
      await pluginCommand(page, 'plugin.reload', { pluginId })
      await expect(frame.locator('#source-version')).toHaveText('Source revision two', {
        timeout: 15_000,
      })
      await expect(frame.locator('#count')).toHaveText('2')
      const replacementStartup = await invokeClock(node)
      const replacementUrl = await node.locator('iframe').getAttribute('src')
      const manifestPath = join(source, 'opencove.plugin.json')
      const originalManifest = await readFile(manifestPath, 'utf8')
      await writeFile(
        manifestPath,
        JSON.stringify({ ...JSON.parse(originalManifest), engines: { opencove: '>=999.0.0' } }),
      )
      const compatibilityError = await pluginCommand(page, 'plugin.reload', { pluginId }).then(
        () => '',
        cause => String(cause),
      )
      expect(compatibilityError).toContain('requires OpenCove >=999.0.0')
      expect(await invokeClock(node)).toBe(replacementStartup)
      expect(await node.locator('iframe').getAttribute('src')).toBe(replacementUrl)
      await expect(frame.locator('#count')).toHaveText('2')
      await writeFile(manifestPath, originalManifest)
      await writeFile(join(source, 'main.mjs'), 'throw new Error("Deliberate invalid candidate")\n')
      const error = await pluginCommand(page, 'plugin.reload', { pluginId }).then(
        () => '',
        cause => String(cause),
      )
      expect(error).toContain('Deliberate invalid candidate')
      expect(await invokeClock(node)).toBe(replacementStartup)
      expect(await node.locator('iframe').getAttribute('src')).toBe(replacementUrl)
      const durable = await savedPluginNodes(page)
      await openLocalDetails(page)
      await page.getByTestId(`settings-plugin-enabled-${pluginId}`).click()
      await expect(page.getByTestId(`settings-plugin-enabled-${pluginId}`)).not.toBeChecked()
      await page.locator('.settings-panel__close').click()
      await expect(node.locator('iframe')).toHaveCount(0)
      await expect(node).toBeVisible()
      await expect(page.getByTestId(actionBarId)).toHaveCount(0)
      expect(await savedPluginNodes(page)).toEqual(durable)
      await openLocalDetails(page)
      await page.getByTestId(`settings-plugin-enabled-${pluginId}`).click()
      await expect(page.getByTestId(`settings-plugin-enabled-${pluginId}`)).toBeChecked()
      await page.locator('.settings-panel__close').click()
      await expect(frame.locator('#count')).toHaveText('2', { timeout: 15_000 })
      await expect(frame.locator('#source-version')).toHaveText('Source revision two')
      expect(await savedPluginNodes(page)).toEqual(durable)
    } finally {
      await electronApp.close()
      await removePathWithRetry(source)
      await removePathWithRetry(userDataDir)
    }
  })

  test('renders independent details and opt-in previews without changing a real node', async ({
    browserName: _browserName,
  }, info) => {
    test.setTimeout(90_000)
    const source = await copyPluginFixture()
    // A 1x surface keeps iframe-edge pointer coverage consistent with Linux CI.
    const { electronApp, window: page } = await launchApp({ deviceScaleFactor: 1 })
    try {
      // Resize the native surface, not just CDP's emulated viewport: otherwise
      // lower iframe controls are painted outside Electron's hit-testable area.
      const nativeWindow = await electronApp.browserWindow(page)
      await nativeWindow.evaluate(window => window.setContentSize(1450, 1100, false))
      await expect
        .poll(() => page.evaluate(() => ({ width: innerWidth, height: innerHeight })))
        .toEqual({ width: 1450, height: 1100 })
      await clearAndSeedWorkspace(page, [], { settings: { ...settings, canvasInputMode: 'auto' } })
      await installPlugin(page, source)
      const real = await createPluginNode(page)
      await clickPluginControl(real.frameLocator('iframe').locator('#increment'))
      await expect(real.frameLocator('iframe').locator('#count')).toHaveText('1')
      const durable = await savedPluginNodes(page)
      let detail = await openLocalDetails(page)
      await expect(detail).toContainText('Local plugin')
      await expect(detail.getByTestId('plugin-readme')).toContainText(
        'independently installed OpenCove plugin',
      )
      const illustration = detail
        .getByTestId('plugin-readme')
        .getByRole('img', { name: 'Clock icon' })
      await expect
        .poll(() => illustration.evaluate(image => (image as HTMLImageElement).naturalWidth))
        .toBeGreaterThan(0)
      expect(await detail.locator('iframe').count()).toBe(0)
      await detail.getByRole('button', { name: 'Start preview' }).click()
      let preview = detail.frameLocator('iframe')
      await expect(preview.locator('#invoke')).toBeEnabled({ timeout: 15_000 })
      await expect(preview.locator('#mode')).toHaveText('INTERACTIVE SAMPLE')
      await expect(preview.locator('#count')).toHaveText('0')
      await clickPluginControl(preview.locator('#invoke'))
      await expect(preview.locator('#backend-result')).toHaveAttribute(
        'data-iso',
        '2030-01-01T12:34:56.000Z',
      )
      await clickPluginControl(preview.locator('#increment'))
      await expect(preview.locator('#count')).toHaveText('1')
      await clickPluginControl(preview.locator('#increment'))
      await expect(preview.locator('#count')).toHaveText('2')
      await preview.locator('#label').fill('Preview clock only')
      await clickPluginControl(preview.locator('#save'))
      await expect(detail.locator('.cove-canvas-node-window__title')).toHaveText(
        'Preview clock only',
      )
      await expect(real.locator('.cove-canvas-node-window__title')).toHaveText('Hello Clock')
      await expect(real.frameLocator('iframe').locator('#count')).toHaveText('1')
      expect(await savedPluginNodes(page)).toEqual(durable)
      await capturePlugins(page, info, 'installed-plugin-detail-pixel')
      await detail.getByRole('button', { name: 'Close preview' }).click()
      await expect(detail.locator('iframe')).toHaveCount(0)
      await detail.getByRole('button', { name: 'Start preview' }).click()
      preview = detail.frameLocator('iframe')
      await expect(preview.locator('#count')).toHaveText('0', { timeout: 15_000 })
      const enabledPreviewSource = await detail.locator('iframe').getAttribute('src')
      await detail.getByTestId(`settings-plugin-enabled-${pluginId}`).click()
      await expect(detail.getByTestId(`settings-plugin-enabled-${pluginId}`)).not.toBeChecked()
      await expect(detail.locator('iframe')).not.toHaveAttribute('src', enabledPreviewSource!)
      await expect(preview.locator('#invoke')).toBeEnabled({ timeout: 15_000 })
      await clickPluginControl(preview.locator('#invoke'))
      await expect(preview.locator('#backend-result')).toHaveAttribute(
        'data-iso',
        '2030-01-01T12:34:56.000Z',
      )
      const disabledPreviewSource = await detail.locator('iframe').getAttribute('src')
      await detail.getByTestId(`settings-plugin-enabled-${pluginId}`).click()
      await expect(detail.getByTestId(`settings-plugin-enabled-${pluginId}`)).toBeChecked()
      await expect(detail.locator('iframe')).not.toHaveAttribute('src', disabledPreviewSource!)
      await expect(preview.locator('#invoke')).toBeEnabled({ timeout: 15_000 })
      await clickPluginControl(preview.locator('#invoke'))
      await expect(preview.locator('#backend-result')).toHaveAttribute(
        'data-iso',
        '2030-01-01T12:34:56.000Z',
      )
      await page.getByTestId('settings-section-nav-appearance').click()
      await selectCoveOption(page, 'settings-ui-theme', 'pixel-light')
      await page.getByTestId('settings-section-nav-plugins').click()
      await page.getByTestId(`settings-plugin-details-${pluginId}`).click()
      detail = page.getByTestId(`settings-plugin-detail-${pluginId}`)
      await detail.getByRole('button', { name: 'Start preview' }).click()
      preview = detail.frameLocator('iframe')
      await expect(preview.locator('html')).toHaveAttribute('data-theme', 'light')
      await expect(preview.locator('#invoke')).toBeEnabled()
      await capturePlugins(page, info, 'installed-plugin-detail-pixel-light')
      await page.locator('.settings-panel__close').click()
      await real.getByTestId('plugin-hello-clock-close').click()
      const recreated = await createPluginNode(page)
      await expect(recreated.frameLocator('iframe').locator('#count')).toHaveText('1')
    } finally {
      await electronApp.close()
      await removePathWithRetry(source)
    }
  })

  test('loads the same installed source and backend through Worker Web UI', async () => {
    test.setTimeout(90_000)
    const source = await copyPluginFixture()
    const userDataDir = await createTestUserDataDir()
    await writeFile(
      join(userDataDir, 'home-worker.json'),
      JSON.stringify({
        version: 1,
        mode: 'local',
        remote: null,
        webUi: { enabled: true, port: null, exposeOnLan: false, passwordHash: null },
        updatedAt: null,
      }),
    )
    const { electronApp, window: desktop } = await launchApp({ userDataDir })
    const browser = await chromium.launch({ headless: true })
    try {
      await clearAndSeedWorkspace(desktop, [], { settings })
      await installPlugin(desktop, source)
      const desktopNode = await createPluginNode(desktop)
      const startup = await invokeClock(desktopNode)
      await clickPluginControl(desktopNode.frameLocator('iframe').locator('#increment'))
      await expect(desktopNode.frameLocator('iframe').locator('#count')).toHaveText('1')
      const webUiUrl = await desktop.evaluate(
        async () => await window.opencoveApi.worker.getWebUiUrl(),
      )
      expect(webUiUrl).toBeTruthy()
      const webContext = await browser.newContext({ viewport: { width: 1400, height: 1000 } })
      const web = await webContext.newPage()
      const lifecycleSockets: string[] = []
      const lifecycleErrors: string[] = []
      web.on('websocket', socket => {
        if (socket.url().includes('/__lifecycle')) {
          lifecycleSockets.push(socket.url())
        }
      })
      web.on('console', message => {
        if (
          /Content Security Policy|Refused to connect/.test(message.text()) &&
          /ws:|wss:|__lifecycle/.test(message.text())
        ) {
          lifecycleErrors.push(message.text())
        }
      })
      await web.goto(webUiUrl!, { waitUntil: 'domcontentloaded' })
      const webNode = web
        .locator('.workspace-main .react-flow__node')
        .filter({ has: web.getByTestId(`plugin-view-${pluginId}`) })
      await expect(webNode.frameLocator('iframe').locator('#invoke')).toBeEnabled({
        timeout: 30_000,
      })
      expect(await invokeClock(webNode)).toBe(startup)
      await expect(webNode.frameLocator('iframe').locator('#count')).toHaveText('1')
      await clickPluginControl(webNode.frameLocator('iframe').locator('#increment'))
      await expect(webNode.frameLocator('iframe').locator('#count')).toHaveText('2')
      await expect.poll(() => lifecycleSockets.length).toBeGreaterThan(0)
      const oldSource = (await webNode.locator('iframe').getAttribute('src'))!
      await web.reload()
      await expect(webNode.frameLocator('iframe').locator('#count')).toHaveText('2', {
        timeout: 30_000,
      })
      expect(await invokeClock(webNode)).toBe(startup)
      await expect.poll(async () => (await webContext.request.get(oldSource)).status()).toBe(404)
      const beforeRestore = (await webNode.locator('iframe').getAttribute('src'))!
      await webNode
        .frameLocator('iframe')
        .locator('body')
        .evaluate(() => {
          window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))
        })
      await expect
        .poll(async () => (await webContext.request.get(beforeRestore)).status())
        .toBe(404)
      await webNode
        .frameLocator('iframe')
        .locator('body')
        .evaluate(() => {
          window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
        })
      await expect(webNode.locator('iframe')).not.toHaveAttribute('src', beforeRestore)
      await expect(webNode.frameLocator('iframe').locator('#invoke')).toBeEnabled()
      expect(await invokeClock(webNode)).toBe(startup)
      await expect(webNode.frameLocator('iframe').locator('#count')).toHaveText('2')
      const currentSource = (await webNode.locator('iframe').getAttribute('src'))!
      await web.close()
      await expect
        .poll(async () => (await webContext.request.get(currentSource)).status())
        .toBe(404)
      expect(lifecycleErrors).toEqual([])
    } finally {
      await browser.close()
      await electronApp.close()
      await removePathWithRetry(source)
    }
  })
})
