import { expect, test } from '@playwright/test'
import { launchApp } from './workspace-canvas.helpers'

const windowsOnly = process.platform !== 'win32'

test.describe('Performance Monitor (Windows)', () => {
  test.skip(windowsOnly, 'Windows only')

  test('opens the header performance monitor panel', async ({ browserName }, testInfo) => {
    const { electronApp, window } = await launchApp()

    try {
      void browserName

      const performanceButton = window.locator('[data-testid="app-header-performance-monitor"]')
      await expect(performanceButton).toBeVisible()
      await performanceButton.click()

      const panel = window.locator('[data-testid="performance-monitor-panel"]')
      await expect(panel).toBeVisible()
      await expect(panel).toContainText(/Frame p95|帧耗时 p95/)
      await expect(panel).toContainText(/Memory in use|正在使用内存/)

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
