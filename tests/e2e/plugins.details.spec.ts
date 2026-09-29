/* eslint-disable no-await-in-loop -- Theme changes and preview pointer gestures run in sequence. */
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test'
import {
  clearAndSeedWorkspace,
  dragMouse,
  launchApp,
  readLocatorClientRect,
  seededWorkspaceId,
  selectCoveOption,
} from './workspace-canvas.helpers'

async function readWorkspace(page: Page) {
  return page.evaluate(async id => {
    const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
    const state = JSON.parse(raw ?? '{}') as {
      workspaces?: Array<{ id: string; nodes: unknown[] }>
    }
    return state.workspaces?.find(workspace => workspace.id === id) ?? null
  }, seededWorkspaceId)
}

async function openDetails(page: Page) {
  await page.getByTestId('settings-plugin-details-git-board').click()
  await expect(page.getByTestId('settings-plugin-detail-git-board')).toBeVisible()
}

async function capture(page: Page, info: TestInfo, name: string) {
  const path = info.outputPath(`${name}.png`)
  await page.screenshot({ path })
  await info.attach(name, { path, contentType: 'image/png' })
}

async function previewFrame(window: Locator) {
  return window.evaluate(element => {
    const bounds = element.getBoundingClientRect()
    const canvas = element.closest('[data-testid="plugin-node-preview"]')!
    const canvasBounds = canvas.getBoundingClientRect()
    return {
      x: bounds.x - canvasBounds.x,
      y: bounds.y - canvasBounds.y,
      width: bounds.width,
      height: bounds.height,
    }
  })
}

async function moveBy(page: Page, target: Locator, dx: number, dy: number) {
  const rect = await readLocatorClientRect(target)
  const start = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
  await dragMouse(page, { start, end: { x: start.x + dx, y: start.y + dy } })
}

async function expectNoHorizontalOverflow(page: Page, locators: Locator[]) {
  for (const locator of locators) {
    const dimensions = await locator.evaluate(element => ({
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
    }))
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1)
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    page.viewportSize()!.width,
  )
}

test.describe('Plugin details', () => {
  test('opens readable Markdown and an interactive preview without changing the real workspace', async ({
    browserName: _browserName,
  }, testInfo) => {
    const { electronApp, window: page } = await launchApp()
    try {
      await page.setViewportSize({ width: 1500, height: 1050 })
      await clearAndSeedWorkspace(
        page,
        [
          {
            id: 'plugin-preview-workspace-note',
            kind: 'note',
            title: 'Keep this real window',
            task: { text: 'The preview must stay independent of my canvas.' },
            position: { x: 110, y: 90 },
            width: 320,
            height: 240,
          },
        ],
        {
          settings: {
            language: 'en',
            uiTheme: 'pixel',
            disabledPluginIds: ['git-board'],
            focusNodeOnClick: false,
          },
        },
      )
      const baseline = await readWorkspace(page)
      await page.getByTestId('app-header-settings').click()
      await page.getByTestId('settings-section-nav-plugins').click()
      await expect(page.getByTestId('settings-plugin-enabled-git-board')).not.toBeChecked()
      await capture(page, testInfo, 'plugins-list-refined-pixel')
      await openDetails(page)
      const detail = page.getByTestId('settings-plugin-detail-git-board')
      await expect(detail).toContainText('Git Board')
      await expect(detail).toContainText('0.1.0')
      const readme = detail.getByTestId('plugin-readme')
      await expect(
        readme.getByRole('heading', { name: 'Your repository, beside your work' }),
      ).toBeVisible()
      await expect(readme.locator('pre code')).toContainText('opencove plugin guide')
      await expect(readme.getByRole('link', { name: 'Git history' })).toHaveAttribute(
        'href',
        'https://git-scm.com/docs/git-log',
      )
      const illustration = readme.locator('img').first()
      await expect(illustration).toBeAttached()
      await expect(illustration).toHaveAttribute(
        'alt',
        'Illustration of a vertical commit history connected to a canvas window',
      )
      await illustration.scrollIntoViewIfNeeded()
      await expect
        .poll(() => illustration.evaluate(image => (image as HTMLImageElement).naturalWidth))
        .toBeGreaterThan(0)
      const preview = detail.getByTestId('plugin-node-preview')
      await preview.scrollIntoViewIfNeeded()
      const node = preview.getByTestId('plugin-preview-node-plugin-preview-git-board')
      await expect(node).toBeVisible()
      await expect(node).toContainText('Refine plugin window controls')
      await expect(node).toContainText('feat/plugin-host')
      const initial = await previewFrame(node)
      const header = node.locator('.cove-canvas-node-window__header')
      // The title is the central, inert drag surface; the other header targets are actions.
      await moveBy(page, header.locator('.cove-canvas-node-window__title'), -24, -16)
      await expect
        .poll(async () => {
          const next = await previewFrame(node)
          return Math.hypot(next.x - initial.x, next.y - initial.y)
        })
        .toBeGreaterThan(15)
      const moved = await previewFrame(node)
      await moveBy(page, node.getByTestId('plugin-preview-resizer-bottom-right'), 32, 24)
      await expect
        .poll(async () => (await previewFrame(node)).width)
        .toBeGreaterThan(moved.width + 15)
      await expect
        .poll(async () => (await previewFrame(node)).height)
        .toBeGreaterThan(moved.height + 10)
      await node.getByTestId('node-collapse').click()
      await expect(preview.getByTestId('node-expand')).toBeVisible()
      await preview.getByTestId('node-expand').click()
      await expect(node).toBeVisible()
      await node.getByTestId('plugin-preview-refresh').click()
      await expect(node).toContainText('Polish the canvas preview')
      await preview.getByTestId('plugin-preview-reset').click()
      await expect.poll(() => previewFrame(node)).toEqual(initial)
      await expect(node).not.toContainText('Polish the canvas preview')
      await node.getByTestId('plugin-preview-close').click()
      await expect(node).toBeHidden()
      await preview.getByTestId('plugin-preview-restore').click()
      await expect(node).toBeVisible()
      await expect.poll(() => previewFrame(node)).toEqual(initial)
      await expect(page.getByTestId('settings-plugin-enabled-git-board')).not.toBeChecked()
      expect(await readWorkspace(page)).toEqual(baseline)
      await capture(page, testInfo, 'plugins-details-preview-pixel')
      await page.getByTestId('settings-plugin-back').click()
      await expect(detail).toHaveCount(0)
      await expect(page.getByTestId('settings-plugin-details-git-board')).toBeFocused()
      await page.getByTestId('settings-section-nav-appearance').click()
      await selectCoveOption(page, 'settings-ui-theme', 'pixel-light')
      await page.getByTestId('settings-section-nav-plugins').click()
      await capture(page, testInfo, 'plugins-list-refined-pixel-light')
      await openDetails(page)
      await expect(node).toBeVisible()
      await capture(page, testInfo, 'plugins-details-preview-pixel-light')
      expect(await readWorkspace(page)).toEqual(baseline)
      await page.locator('.settings-panel__close').click()
      await expect(page.locator('.workspace-canvas .react-flow__node')).toHaveCount(1)
      await expect(page.getByTestId('workspace-canvas-action-bar-new-git-board')).toHaveCount(0)
    } finally {
      await electronApp.close()
    }
  })

  test('keeps plugin details and the interactive preview usable at 320px in both themes', async ({
    browserName: _browserName,
  }, testInfo) => {
    const { electronApp, window: page } = await launchApp()
    try {
      await clearAndSeedWorkspace(page, [], {
        settings: { language: 'zh-CN', uiTheme: 'pixel', disabledPluginIds: ['git-board'] },
      })
      await page.getByTestId('app-header-settings').click()
      await page.getByTestId('settings-section-nav-plugins').click()
      await page.setViewportSize({ width: 320, height: 800 })
      for (const theme of ['pixel', 'pixel-light']) {
        if (theme === 'pixel-light') {
          await selectCoveOption(page, 'settings-panel-page-selector', 'appearance')
          await selectCoveOption(page, 'settings-ui-theme', theme)
          await selectCoveOption(page, 'settings-panel-page-selector', 'plugins')
        }
        await capture(page, testInfo, `plugins-list-320-${theme}`)
        await openDetails(page)
        const detail = page.getByTestId('settings-plugin-detail-git-board')
        const preview = detail.getByTestId('plugin-node-preview')
        await preview.scrollIntoViewIfNeeded()
        await expectNoHorizontalOverflow(page, [
          page.getByTestId('settings-panel'),
          detail,
          preview,
          detail.getByTestId('plugin-readme'),
        ])
        await capture(page, testInfo, `plugins-details-preview-320-${theme}`)
        await preview.getByTestId('node-collapse').click()
        await expect(preview.getByTestId('node-expand')).toBeVisible()
        await preview.getByTestId('node-expand').click()
        await expect(preview.getByTestId('plugin-preview-refresh')).toBeVisible()
        await detail.getByTestId('plugin-readme').scrollIntoViewIfNeeded()
        await capture(page, testInfo, `plugins-details-readme-320-${theme}`)
        await page.getByTestId('settings-plugin-back').click()
        await expect(detail).toHaveCount(0)
      }
      expect((await readWorkspace(page))?.nodes).toEqual([])
    } finally {
      await electronApp.close()
    }
  })
})
