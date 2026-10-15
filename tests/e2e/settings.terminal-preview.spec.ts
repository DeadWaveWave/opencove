/* eslint-disable no-await-in-loop -- Themes and viewports share one Electron window and must settle sequentially. */
import { expect, test } from '@playwright/test'
import { clearAndSeedWorkspace, launchApp } from './workspace-canvas.helpers'

test('updates terminal preview material through the theme buttons without replacing its DOM', async ({
  browserName: _browserName,
}, testInfo) => {
  const { electronApp, window: page } = await launchApp()
  try {
    await clearAndSeedWorkspace(page, [], { settings: { uiTheme: 'dark' } })
    await page.getByTestId('app-header-settings').click()
    await page.getByTestId('settings-section-nav-appearance').click()
    await page.getByTestId('settings-ui-theme-pixel').click()
    await expect(page.locator('html')).toHaveAttribute('data-cove-theme-id', 'pixel')
    const preview = page.getByTestId('settings-pixel-effects-preview')
    const original = await preview.elementHandle()
    const terminal = preview.locator('[data-id="settings-preview-terminal"]')
    await expect(terminal.locator('svg.lucide-terminal')).toHaveCount(1)
    const body = terminal.locator('.settings-pixel-preview__body')
    const header = terminal.locator('.settings-pixel-preview__header')
    await expect(header).toHaveCSS('overflow', 'hidden')
    const headerRadius = await header.evaluate(
      element => getComputedStyle(element).borderTopLeftRadius,
    )
    expect(parseFloat(headerRadius)).toBeGreaterThan(0)
    const dark = await body.evaluate(element => ({
      body: getComputedStyle(element).backgroundColor,
      accent: getComputedStyle(element).getPropertyValue('--cove-pixel-blue'),
    }))
    await page.getByTestId('settings-ui-theme-pixel-light').click()
    await expect(page.locator('html')).toHaveAttribute('data-cove-theme-id', 'pixel-light')
    expect(await preview.evaluate((element, previous) => element === previous, original)).toBe(true)
    await expect
      .poll(() => body.evaluate(element => getComputedStyle(element).backgroundColor))
      .not.toBe(dark.body)
    expect(
      await body.evaluate(element =>
        getComputedStyle(element).getPropertyValue('--cove-pixel-blue'),
      ),
    ).not.toBe(dark.accent)
    await expect(terminal.locator('svg.lucide-terminal')).toHaveCount(1)
    const bodyBottomGap = await terminal.evaluate(element => {
      const contentElement = element.querySelector('.settings-pixel-preview__body')!
      return element.getBoundingClientRect().bottom - contentElement.getBoundingClientRect().bottom
    })
    // The body sits on the reading plate: one 6px inset above the frame's 1px border.
    expect(bodyBottomGap).toBeGreaterThanOrEqual(6)
    expect(bodyBottomGap).toBeLessThanOrEqual(7)
    await preview.scrollIntoViewIfNeeded()
    const path = testInfo.outputPath('theme-preview-live-pixel-light.png')
    await preview.screenshot({ path, animations: 'disabled' })
    await testInfo.attach('theme-preview-live-pixel-light', { path, contentType: 'image/png' })
    await original?.dispose()
  } finally {
    await electronApp.close()
  }
})

test('previews terminal typography in a stable themed window', async ({
  browserName: _browserName,
}, testInfo) => {
  const { electronApp, window: page } = await launchApp()
  try {
    for (const uiTheme of ['pixel', 'pixel-light', 'dark', 'light']) {
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
      // Compare layout size independently of the settings dialog's entrance transform.
      const initialHeight = await preview.evaluate(element => element.clientHeight)
      const headerFont = await header.evaluate(element => getComputedStyle(element).fontSize)
      await page.getByTestId('settings-terminal-font-size').fill('22')
      await expect(content).toHaveCSS('font-size', '22px')
      await expect(header).toHaveCSS('font-size', headerFont)
      expect(await preview.evaluate(element => element.clientHeight)).toBe(initialHeight)
      await expect(header.locator('svg.lucide-terminal')).toHaveCount(1)
      const palette = await content.evaluate(element => {
        const swatch = document.createElement('span')
        swatch.style.backgroundColor = 'var(--cove-terminal-background)'
        element.append(swatch)
        const expected = getComputedStyle(swatch).backgroundColor
        swatch.remove()
        return { actual: getComputedStyle(element).backgroundColor, expected }
      })
      expect(palette.actual).toBe(palette.expected)
      expect(palette.actual).not.toBe('rgba(0, 0, 0, 0)')
      const chrome = await header.evaluate(element => ({
        band: getComputedStyle(element, '::before').backgroundImage,
        material: getComputedStyle(element).backdropFilter,
        radius: getComputedStyle(element.parentElement!).borderRadius,
        headerRadius: getComputedStyle(element).borderTopLeftRadius,
        overflow: getComputedStyle(element).overflow,
      }))
      expect(chrome.band).toContain('linear-gradient')
      // Window headers are a pre-composited tint; Pixel sets no header blur.
      expect(chrome.material).toBe('none')
      expect(chrome.radius).not.toBe('0px')
      expect(parseFloat(chrome.headerRadius)).toBeGreaterThan(0)
      expect(chrome.overflow).toBe('hidden')
      for (const width of [1200, 720]) {
        await electronApp.evaluate(({ BrowserWindow }, size) => {
          BrowserWindow.getAllWindows()[0].setContentSize(size, 900, false)
        }, width)
        await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(width)
        await preview.scrollIntoViewIfNeeded()
        await expect(preview).toBeInViewport()
        const size = await page.getByTestId('settings-panel').evaluate(element => ({
          client: element.clientWidth,
          scroll: element.scrollWidth,
        }))
        expect(size.scroll).toBeLessThanOrEqual(size.client + 1)
        const path = testInfo.outputPath(`terminal-preview-${uiTheme}-${width}.png`)
        await page.getByTestId('settings-panel').screenshot({ path, animations: 'disabled' })
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
