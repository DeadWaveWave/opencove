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
      await expect(diagnosticsSection).not.toContainText(/Reserved memory|已申请内存/)
      await expect(diagnosticsSection).toContainText(/Threads|线程/)
      await expect(diagnosticsSection).toContainText(/OpenCove main|OpenCove main/)
      const mainRow = diagnosticsSection.locator('tbody tr', {
        hasText: /OpenCove main|OpenCove main/,
      })
      await expect(mainRow.locator('td').nth(4)).not.toHaveText('-')
    } finally {
      await electronApp.close()
    }
  })
})
