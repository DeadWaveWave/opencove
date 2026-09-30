/* eslint-disable no-await-in-loop -- Theme changes and preview gestures run in sequence. */
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test'
import { rm } from 'node:fs/promises'
import {
  clearAndSeedWorkspace,
  dragMouse,
  launchApp,
  readLocatorClientRect,
  seededWorkspaceId,
  selectCoveOption,
} from './workspace-canvas.helpers'
import {
  copyPluginFixture,
  installPlugin,
  openLocalDetails,
  clickPluginControl,
  savedPluginNodes,
} from './plugins.local.helpers'

async function capture(page: Page, info: TestInfo, name: string) {
  const screenshot = `/tmp/opencove-plugin-library-review/${name}.png`
  await page.screenshot({ path: screenshot })
  await info.attach(name, { path: screenshot, contentType: 'image/png' })
}
async function moveBy(page: Page, target: Locator, dx: number, dy: number) {
  const rect = await readLocatorClientRect(target)
  const start = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
  await dragMouse(page, { start, end: { x: start.x + dx, y: start.y + dy } })
}
async function frame(node: Locator) {
  return node.evaluate(element => {
    const rect = element.getBoundingClientRect()
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
  })
}

test.describe('Installed plugin details', () => {
  test('reads Markdown and runs an isolated interactive preview in light, dark and narrow layouts', async ({
    browserName: _browserName,
  }, testInfo) => {
    const directory = await copyPluginFixture()
    const { electronApp, window: page } = await launchApp()
    try {
      await page.setViewportSize({ width: 1400, height: 1000 })
      await clearAndSeedWorkspace(
        page,
        [
          {
            id: 'keep-note',
            kind: 'note',
            title: 'Keep this real window',
            task: { text: 'Preview is separate.' },
            position: { x: 110, y: 90 },
            width: 320,
            height: 240,
          },
        ],
        { settings: { language: 'en', uiTheme: 'pixel', focusNodeOnClick: false } },
      )
      await installPlugin(page, directory)
      const detail = await openLocalDetails(page)
      await expect(detail).toContainText('Hello Clock')
      const readme = detail.getByTestId('plugin-readme')
      await expect(readme.getByRole('heading', { name: 'Hello Clock', exact: true })).toBeVisible()
      const illustration = readme.getByRole('img', { name: 'Clock icon' })
      await illustration.scrollIntoViewIfNeeded()
      await expect
        .poll(() => illustration.evaluate(image => (image as HTMLImageElement).naturalWidth))
        .toBeGreaterThan(0)
      const preview = detail.getByTestId('plugin-node-preview')
      await expect(preview.locator('iframe')).toHaveCount(0)
      await preview.getByTestId('plugin-runtime-preview-toggle').click()
      const node = preview.locator('[data-testid^="plugin-preview-node-"]')
      const content = node.frameLocator('iframe')
      await expect(content.locator('#invoke')).toBeEnabled()
      await clickPluginControl(content.locator('#invoke'))
      await expect(content.locator('#status')).toContainText('Sample time; real data is untouched.')
      await preview.scrollIntoViewIfNeeded()
      const initial = await frame(node)
      await moveBy(page, node.locator('.cove-canvas-node-window__title'), 24, 16)
      await expect
        .poll(async () => {
          const next = await frame(node)
          return Math.hypot(next.x - initial.x, next.y - initial.y)
        })
        .toBeGreaterThan(10)
      const moved = await frame(node)
      await moveBy(page, node.getByTestId('plugin-preview-resizer-bottom-right'), 30, 24)
      await expect.poll(async () => (await frame(node)).width).toBeGreaterThan(moved.width + 10)
      await node.getByTestId('node-collapse').click()
      await expect(preview.getByTestId('node-expand')).toBeVisible()
      await preview.getByTestId('node-expand').click()
      await expect(content.locator('#invoke')).toBeEnabled()
      await capture(page, testInfo, 'plugin-details-dark')
      expect(await savedPluginNodes(page)).toEqual([])
      await page.getByTestId('settings-plugin-back').click()
      await expect(page.getByTestId('settings-plugin-details-hello-clock')).toBeFocused()
      await capture(page, testInfo, 'plugin-manager-dark')
      await page.getByTestId('settings-section-nav-appearance').click()
      await selectCoveOption(page, 'settings-ui-theme', 'pixel-light')
      await page.getByTestId('settings-section-nav-plugins').click()
      await capture(page, testInfo, 'plugin-manager-light')
      await page.getByTestId('settings-plugin-details-hello-clock').click()
      await preview.getByTestId('plugin-runtime-preview-toggle').click()
      await expect(content.locator('#invoke')).toBeEnabled()
      await detail.locator('.settings-plugin-detail__header').scrollIntoViewIfNeeded()
      await capture(page, testInfo, 'plugin-details-light-overview')
      await preview.scrollIntoViewIfNeeded()
      await capture(page, testInfo, 'plugin-details-light')
      await content.locator('#label').fill('Unsaved preview label')
      await page.setViewportSize({ width: 320, height: 800 })
      await expect(content.locator('#label')).toHaveValue('Unsaved preview label')
      await expect
        .poll(() => node.evaluate(element => (element as HTMLElement).offsetWidth))
        .toBeGreaterThanOrEqual(320)
      for (const theme of ['pixel-light', 'pixel']) {
        if (theme === 'pixel') {
          await selectCoveOption(page, 'settings-panel-page-selector', 'appearance')
          await selectCoveOption(page, 'settings-ui-theme', theme)
          await selectCoveOption(page, 'settings-panel-page-selector', 'plugins')
          await page.getByTestId('settings-plugin-details-hello-clock').click()
          await preview.getByTestId('plugin-runtime-preview-toggle').click()
        }
        await preview.scrollIntoViewIfNeeded()
        await expect(content.locator('#invoke')).toBeEnabled()
        for (const target of [detail, preview, readme]) {
          expect(
            await target.evaluate(element => element.scrollWidth - element.clientWidth),
          ).toBeLessThanOrEqual(1)
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
          320,
        )
        await capture(page, testInfo, `plugin-details-320-${theme}`)
        await preview.getByTestId('node-collapse').click()
        await preview.getByTestId('node-expand').click()
      }
      expect(await savedPluginNodes(page)).toEqual([])
      const saved = await page.evaluate(
        async id =>
          JSON.parse(
            (await window.opencoveApi.persistence.readWorkspaceStateRaw()) ?? '{}',
          ).workspaces.find((workspace: { id: string }) => workspace.id === id),
        seededWorkspaceId,
      )
      expect(saved.nodes.map((item: { id: string }) => item.id)).toEqual(['keep-note'])
    } finally {
      await electronApp.close()
      await rm(directory, { recursive: true, force: true })
    }
  })
})
