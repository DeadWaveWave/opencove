import { expect, test } from '@playwright/test'
import { clearAndSeedWorkspace, launchApp } from './workspace-canvas.helpers'

for (const scenario of [
  {
    language: 'en',
    theme: 'pixel-light',
    title: 'Plugin library',
    article: 'Your first plugin, with Hello Clock',
    link: 'API reference',
  },
  {
    language: 'zh-CN',
    theme: 'pixel',
    title: '插件文档库',
    article: '用 Hello Clock 制作第一个插件',
    link: 'API 参考',
  },
] as const) {
  test(`plugin library reads bundled documents in ${scenario.language}`, async ({
    browserName: _browserName,
  }, testInfo) => {
    const { electronApp, window: page } = await launchApp()
    try {
      await page.setViewportSize({ width: 1400, height: 1000 })
      await clearAndSeedWorkspace(page, [], {
        settings: { language: scenario.language, uiTheme: scenario.theme },
      })
      await page.getByTestId('app-header-settings').click()
      await page.getByTestId('settings-section-nav-plugins').click()
      await expect(page.getByTestId('settings-plugins-empty')).toBeVisible()
      await page.getByTestId('settings-plugins-documentation').click()
      const library = page.getByTestId('plugin-documentation-library')
      await expect(library.getByRole('heading', { name: scenario.title })).toBeFocused()
      const indexScreenshot = `/tmp/opencove-plugin-library-review/library-${scenario.theme}.png`
      await page.screenshot({ path: indexScreenshot })
      await testInfo.attach(`library-${scenario.theme}`, {
        path: indexScreenshot,
        contentType: 'image/png',
      })
      await page.getByTestId('plugin-library-build').click()
      await expect(library.getByRole('heading', { name: scenario.article })).toBeVisible()
      await expect(library.getByTestId('plugin-readme')).toContainText('opencove plugin guide')
      await library.getByRole('link', { name: scenario.link, exact: true }).click()
      await expect(library.getByTestId('plugin-readme')).toContainText('window.opencovePlugin')
      await page.getByTestId('plugin-library-back').click()
      await expect(page.getByTestId('plugin-library-build')).toBeFocused()
      await page.setViewportSize({ width: 320, height: 800 })
      await page.getByTestId('plugin-library-build').click()
      await expect(library.getByRole('heading', { name: scenario.article })).toBeVisible()
      expect(
        await library.evaluate(element => element.scrollWidth - element.clientWidth),
      ).toBeLessThanOrEqual(1)
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        320,
      )
      const narrowScreenshot = `/tmp/opencove-plugin-library-review/library-320-${scenario.theme}.png`
      await page.screenshot({ path: narrowScreenshot })
      await testInfo.attach(`library-320-${scenario.theme}`, {
        path: narrowScreenshot,
        contentType: 'image/png',
      })
      await page.getByTestId('plugin-library-back').click()
      await page.getByTestId('plugin-library-back').click()
      await expect(page.getByTestId('settings-plugins-documentation')).toBeFocused()
      await expect(page.locator('.workspace-main .react-flow__node')).toHaveCount(0)
    } finally {
      await electronApp.close()
    }
  })
}
