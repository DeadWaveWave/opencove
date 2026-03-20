import { expect, test } from '@playwright/test'
import { clearAndSeedWorkspace, launchApp, selectCoveOption } from './workspace-canvas.helpers'

test.describe('Workspace Canvas - Terminal Theme', () => {
  test('keeps terminal theme synchronized after switching ui theme', async ({
    browserName,
  }, testInfo) => {
    const { electronApp, window } = await launchApp()

    try {
      void browserName
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'node-terminal-theme',
            title: 'terminal-theme',
            position: { x: 160, y: 140 },
            width: 520,
            height: 320,
          },
        ],
        {
          settings: {
            uiTheme: 'dark',
          },
        },
      )

      const terminalBody = window.locator('.terminal-node__terminal').first()
      await expect(terminalBody).toBeVisible()
      await expect(terminalBody).toHaveAttribute('data-cove-terminal-theme', 'dark')

      const settingsButton = window.locator('[data-testid="app-header-settings"]')
      await settingsButton.click({ noWaitAfter: true })

      await selectCoveOption(window, 'settings-ui-theme', 'light')

      await expect
        .poll(() =>
          window.evaluate(() => {
            return document.documentElement.dataset.coveTheme ?? null
          }),
        )
        .toBe('light')
      await expect(terminalBody).toHaveAttribute('data-cove-terminal-theme', 'light')

      await window.locator('.settings-panel__close').click()

      const screenshotPath = testInfo.outputPath('terminal-theme-light.png')
      await window.screenshot({ path: screenshotPath })
      await testInfo.attach('terminal-theme-light', {
        path: screenshotPath,
        contentType: 'image/png',
      })
    } finally {
      await electronApp.close()
    }
  })
})
