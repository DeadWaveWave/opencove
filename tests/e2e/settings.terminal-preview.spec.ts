/* eslint-disable no-await-in-loop -- Themes and viewports share one Electron window and must settle sequentially. */
import { expect, test } from '@playwright/test'
import { clearAndSeedWorkspace, launchApp } from './workspace-canvas.helpers'

test('previews terminal typography in a stable themed window', async ({
  browserName: _browserName,
}, testInfo) => {
  const { electronApp, window: page } = await launchApp()
  try {
    for (const uiTheme of ['pixel', 'pixel-light', 'ember-light']) {
      await electronApp.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0].setContentSize(1200, 900, false)
      })
      await clearAndSeedWorkspace(page, [], {
        settings: { uiTheme, terminalFontSize: 14, terminalFontFamily: 'monospace' },
      })
      await page.getByTestId('app-header-settings').click()
      await page.getByTestId('settings-section-nav-terminal').click()
      const preview = page.getByTestId('settings-terminal-typography-preview')
      const content = page.getByTestId('settings-terminal-typography-content')
      const header = preview.locator('.settings-terminal-preview__header')
      await expect(preview).toBeInViewport()
      await expect(content).toHaveCSS('font-family', 'monospace')
      await expect(content).toHaveCSS('font-size', '14px')
      const initialHeight = (await preview.boundingBox())!.height
      const headerFont = await header.evaluate(element => getComputedStyle(element).fontSize)
      await page.getByTestId('settings-terminal-font-size').fill('22')
      await expect(content).toHaveCSS('font-size', '22px')
      await expect(header).toHaveCSS('font-size', headerFont)
      expect((await preview.boundingBox())!.height).toBe(initialHeight)
      const palette = await preview.evaluate(element => {
        const swatch = document.createElement('span')
        swatch.style.backgroundColor = 'var(--cove-terminal-background)'
        element.append(swatch)
        const expected = getComputedStyle(swatch).backgroundColor
        swatch.remove()
        return { actual: getComputedStyle(element).backgroundColor, expected }
      })
      expect(palette.actual).toBe(palette.expected)
      expect(palette.actual).not.toBe('rgba(0, 0, 0, 0)')
      for (const width of [1200, 720]) {
        await electronApp.evaluate(({ BrowserWindow }, size) => {
          BrowserWindow.getAllWindows()[0].setContentSize(size, 900, false)
        }, width)
        await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(width)
        await preview.scrollIntoViewIfNeeded()
        await expect(preview).toBeInViewport()
        const size = await page.getByRole('dialog').evaluate(element => ({
          client: element.clientWidth,
          scroll: element.scrollWidth,
        }))
        expect(size.scroll).toBeLessThanOrEqual(size.client + 1)
        const path = testInfo.outputPath(`terminal-preview-${uiTheme}-${width}.png`)
        await page.getByRole('dialog').screenshot({ path, animations: 'disabled' })
        await testInfo.attach(`terminal-preview-${uiTheme}-${width}`, {
          path,
          contentType: 'image/png',
        })
      }
      await page.keyboard.press('Escape')
    }
  } finally {
    await electronApp.close()
  }
})
