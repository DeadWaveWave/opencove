/* eslint-disable no-await-in-loop -- Themes share one Electron window and must apply in order. */
import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { launchApp } from './workspace-canvas.helpers'
import { auditUiAccessibility } from './ui-accessibility.probe'

const THEMES = ['dark', 'light', 'pixel', 'pixel-light'] as const
type GalleryWindow = Window & { __opencoveUiGalleryTestApi?: { setTheme: (theme: string) => void } }

async function probe(
  page: Page,
  testInfo: TestInfo,
  name: string,
  scope: string,
  { interactive = true }: { interactive?: boolean } = {},
) {
  // Entrance transitions fade layers in; measure the settled colors. Spinners loop forever.
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map(animation => animation.finished.catch(() => null)),
    ),
  )
  const report = await page.evaluate(auditUiAccessibility, { scope })
  await testInfo.attach(`${name}.json`, {
    body: JSON.stringify(report, null, 2),
    contentType: 'application/json',
  })
  expect(report.textCount, `${name}: text found`).toBeGreaterThan(0)
  if (interactive) {
    expect(report.targetCount, `${name}: targets found`).toBeGreaterThan(0)
  }
  expect(report.failingText, `${name}: text contrast`).toEqual([])
  expect(report.smallTargets, `${name}: target size`).toEqual([])
}

test('shared components keep text contrast and target size in every built-in theme', async ({
  browserName: _browserName,
}, testInfo) => {
  const { electronApp, window: page } = await launchApp({
    env: { OPENCOVE_TEST_UI_GALLERY: '1' },
  })
  try {
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(1280, 900, false)
    })
    await expect(page.getByTestId('ui-gallery')).toBeVisible()
    for (const theme of THEMES) {
      await page.evaluate(
        id => (window as GalleryWindow).__opencoveUiGalleryTestApi?.setTheme(id),
        theme,
      )
      await expect(page.locator('html')).toHaveAttribute('data-cove-theme-id', theme)
      await testInfo.attach(`ui-gallery-${theme}`, {
        body: await page.screenshot(),
        contentType: 'image/png',
      })
      await probe(page, testInfo, `gallery-${theme}`, '[data-testid="ui-gallery"]')

      await page.getByTestId('ui-gallery-tooltip-trigger').focus()
      await expect(page.getByRole('tooltip')).toHaveText(
        'Arrange windows by kind, then by last activity',
      )
      await probe(page, testInfo, `tooltip-${theme}`, '[role="tooltip"]', { interactive: false })
      await page.keyboard.press('Escape')
      await expect(page.getByRole('tooltip')).toHaveCount(0)

      await page.getByTestId('ui-gallery-open-dialog').click()
      await expect(page.getByTestId('ui-gallery-dialog')).toBeVisible()
      await probe(page, testInfo, `dialog-${theme}`, '[data-testid="ui-gallery-dialog"]')
      await page.keyboard.press('Escape')
      await expect(page.getByTestId('ui-gallery-dialog')).toHaveCount(0)

      await page.getByTestId('ui-gallery-open-popover').click()
      await expect(page.getByTestId('ui-gallery-popover')).toBeVisible()
      await probe(page, testInfo, `popover-${theme}`, '[data-testid="ui-gallery-popover"]')
      await page.keyboard.press('Escape')
      await expect(page.getByTestId('ui-gallery-popover')).toHaveCount(0)

      await page.getByTestId('ui-gallery-open-menu').click()
      await expect(page.getByRole('menu', { name: 'Canvas' })).toBeVisible()
      await probe(page, testInfo, `menu-${theme}`, '[data-testid="ui-gallery-menu"]')
      await testInfo.attach(`ui-gallery-menu-${theme}`, {
        body: await page.getByTestId('ui-gallery-menu').screenshot(),
        contentType: 'image/png',
      })
      await page.keyboard.press('Escape')
      await expect(page.getByTestId('ui-gallery-menu')).toHaveCount(0)
    }
  } finally {
    await electronApp.close()
  }
})
