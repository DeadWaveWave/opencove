import { expect, test } from '@playwright/test'
import { launchApp } from './workspace-canvas.helpers'

const macOnly = process.platform !== 'darwin'

test.describe('Performance Diagnostics (macOS)', () => {
  test.skip(macOnly, 'macOS only')

  test('shows real process-tree rows in diagnostics settings', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await window.locator('[data-testid="app-header-settings"]').click({ noWaitAfter: true })
      await window.locator('[data-testid="settings-section-nav-diagnostics"]').click()

      const diagnosticsSection = window.locator('#settings-section-diagnostics')
      await expect(diagnosticsSection).toContainText(/Process Totals|进程汇总/)
      await expect(diagnosticsSection).not.toContainText(/Process tree unavailable|进程树不可用/)
      await expect(diagnosticsSection).not.toContainText(
        /Showing Electron process metrics because process-tree rows are empty|进程树暂无行数据/,
      )
      await expect(diagnosticsSection).toContainText(/OpenCove main|OpenCove main/)
    } finally {
      await electronApp.close()
    }
  })
})
