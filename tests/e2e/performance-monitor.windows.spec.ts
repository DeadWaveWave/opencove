import { expect, test } from '@playwright/test'
import { launchApp } from './workspace-canvas.helpers'

const windowsOnly = process.platform !== 'win32'

test.describe('Performance Monitor (Windows)', () => {
  test.skip(windowsOnly, 'Windows only')

  test('opens the header performance monitor panel', async ({ browserName }, testInfo) => {
    const { electronApp, window } = await launchApp()

    try {
      void browserName

      await window.locator('[data-testid="app-header-settings"]').click({ noWaitAfter: true })
      await window.locator('[data-testid="settings-section-nav-diagnostics"]').click()

      const headerToggle = window.locator(
        '[data-testid="settings-performance-monitor-header-button-enabled"]',
      )
      await expect(headerToggle).toBeVisible()
      await headerToggle.check()
      await expect(headerToggle).toBeChecked()
      await window.locator('.settings-panel__close').click()

      const performanceButton = window.locator('[data-testid="app-header-performance-monitor"]')
      await expect(performanceButton).toBeVisible()
      await performanceButton.click()

      const panel = window.locator('[data-testid="performance-monitor-panel"]')
      await expect(panel).toBeVisible()
      await expect(panel).toContainText(/Frame p95|帧耗时 p95/)
      await expect(panel).toContainText(/Memory in use|正在使用内存/)
      await expect(panel).toContainText(/Process tree|进程树/)
      await expect(panel).not.toContainText(/No process rows available|暂无进程数据/)

      const screenshotPath = testInfo.outputPath('performance-monitor-panel.png')
      await window.screenshot({ path: screenshotPath })
      await testInfo.attach('performance-monitor-panel', {
        path: screenshotPath,
        contentType: 'image/png',
      })
    } finally {
      await electronApp.close()
    }
  })
})
