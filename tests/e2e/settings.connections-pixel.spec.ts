/* eslint-disable no-await-in-loop -- Themes and viewports share one Electron window and must settle sequentially. */
import { expect, test, type Locator, type TestInfo } from '@playwright/test'
import { clearAndSeedWorkspace, launchApp } from './workspace-canvas.helpers'

async function expectNoHorizontalOverflow(content: Locator): Promise<void> {
  const size = await content.evaluate(element => ({
    visible: element.clientWidth,
    scroll: element.scrollWidth,
  }))
  expect(size.scroll).toBeLessThanOrEqual(size.visible + 1)
}

async function attachPanel(dialog: Locator, testInfo: TestInfo, name: string): Promise<void> {
  const path = testInfo.outputPath(`${name}.png`)
  await dialog.screenshot({ path, animations: 'disabled' })
  await testInfo.attach(name, {
    path,
    contentType: 'image/png',
  })
}

test('keeps connections available for legacy profiles and groups browser security in both Pixel themes', async ({
  browserName,
}, testInfo) => {
  void browserName
  const { electronApp, window: page } = await launchApp()
  try {
    for (const configuration of [
      { uiTheme: 'pixel', language: 'zh-CN' },
      { uiTheme: 'pixel-light', language: 'en' },
    ] as const) {
      await electronApp.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0].setContentSize(1200, 900, false)
      })
      await clearAndSeedWorkspace(page, [], {
        settings: {
          ...configuration,
          experimentalRemoteWorkersEnabled: false,
          terminalDisplayAutoReferenceEnabled: false,
        },
      })
      await expect(page.locator('html')).toHaveAttribute(
        'data-cove-theme-id',
        configuration.uiTheme,
      )
      await page.getByTestId('app-header-settings').click()
      const dialog = page.getByTestId('settings-panel')
      await page.getByTestId('settings-section-nav-worker').click()
      await expect(dialog.getByTestId('settings-worker-home-mode-trigger')).toHaveCount(0)
      await expect(dialog.getByTestId('settings-experimental-remote-workers-enabled')).toHaveCount(
        0,
      )
      await expect(dialog.getByTestId('settings-worker-local-status')).toHaveCount(0)
      await expect(dialog.locator('#settings-section-worker-local-description')).toHaveCount(0)
      const runtimeTitle = dialog.locator('#settings-section-worker-title')
      await runtimeTitle.scrollIntoViewIfNeeded()
      await expect(runtimeTitle).toBeInViewport()
      await attachPanel(dialog, testInfo, `connections-overview-${configuration.uiTheme}`)

      const endpoints = dialog.locator('#settings-section-endpoints')
      await expect(endpoints).toBeVisible()
      await expect(endpoints.locator('#settings-section-endpoints-list')).toBeVisible()
      const register = endpoints.getByTestId('settings-endpoints-open-register')
      await expect(register).toBeEnabled()
      await expect(endpoints.getByTestId('settings-endpoints-empty-register')).toHaveCount(0)
      await expect(endpoints.locator('.cove-window__empty-card')).toHaveCount(0)
      await endpoints.evaluate(element => element.scrollIntoView({ block: 'start' }))
      await expect(register).toBeInViewport()
      await attachPanel(dialog, testInfo, `connections-${configuration.uiTheme}`)

      const browserAccess = dialog.locator('#settings-section-worker-web-ui')
      await expect(browserAccess.locator('.settings-panel__group-description')).not.toContainText(
        /实验性|experimental/i,
      )
      const security = browserAccess.locator('#settings-section-worker-web-ui-security')
      await expect(security).toHaveCount(1)
      expect(
        await security.evaluate(element => element.closest('.settings-panel__group')?.id),
      ).toBe('settings-section-worker-web-ui')
      await security.scrollIntoViewIfNeeded()
      await expect(
        security.getByTestId('settings-experimental-worker-web-ui-password'),
      ).toHaveAccessibleName(/\S/)
      await expect(
        security.getByTestId('settings-experimental-worker-web-ui-lan'),
      ).toHaveAccessibleName(/\S/)
      const status = browserAccess.getByTestId('settings-experimental-worker-web-ui-status')
      await expect(status).toHaveText(/\S/)
      const refresh = browserAccess.getByTestId('settings-experimental-worker-web-ui-refresh')
      await expect(refresh).toHaveAccessibleName(/\S/)
      await expect(refresh).toBeEnabled()
      await refresh.click()
      await expect(refresh).toBeEnabled()
      await expect(
        browserAccess.getByTestId('settings-experimental-worker-web-ui-open'),
      ).toHaveCount(0)
      await security.scrollIntoViewIfNeeded()
      await expect(
        security.getByTestId('settings-experimental-worker-web-ui-password'),
      ).toBeInViewport()
      await attachPanel(dialog, testInfo, `browser-access-${configuration.uiTheme}`)

      await electronApp.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0].setContentSize(720, 650, false)
      })
      await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(720)
      await expectNoHorizontalOverflow(dialog)
      await expectNoHorizontalOverflow(dialog.locator('.settings-panel__content'))
      const password = security.getByTestId('settings-experimental-worker-web-ui-password')
      await password.scrollIntoViewIfNeeded()
      await expect(password).toBeInViewport()
      await attachPanel(dialog, testInfo, `browser-access-narrow-${configuration.uiTheme}`)
      await endpoints.evaluate(element => element.scrollIntoView({ block: 'start' }))
      await register.scrollIntoViewIfNeeded()
      await expect(register).toBeInViewport()
      await attachPanel(dialog, testInfo, `connections-narrow-${configuration.uiTheme}`)
      await page.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
    }
  } finally {
    await electronApp.close()
  }
})
