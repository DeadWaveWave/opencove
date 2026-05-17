import { expect, test } from '@playwright/test'
import { launchApp } from './workspace-canvas.helpers'

test.describe('Issue report', () => {
  test('generates a report from the header dialog', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await window.locator('[data-testid="app-header-report-issue"]').click()

      const dialog = window.locator('[data-testid="issue-report-dialog"]')
      await expect(dialog).toBeVisible()

      await window
        .locator('[data-testid="issue-report-description"]')
        .fill('Run Agent no longer starts after updating OpenCove.')
      await window.locator('[data-testid="issue-report-generate"]').click()

      await expect(window.locator('[data-testid="issue-report-ready"]')).toBeVisible({
        timeout: 20_000,
      })

      await window.getByRole('button', { name: /Copy Report|复制报告/u }).click()
      const clipboardText = await electronApp.evaluate(({ clipboard }) => clipboard.readText())

      expect(clipboardText).toContain('Run Agent no longer starts after updating OpenCove.')
      expect(clipboardText).toContain('## Diagnostics Manifest')
      expect(clipboardText).toContain('## App Runtime')
      expect(clipboardText).toContain('## Worker State')
      expect(clipboardText).toContain('## Agent State')
      expect(clipboardText).toContain('## Process Snapshot')
      expect(clipboardText).toContain('## Log: runtime-diagnostics.log')
      expect(clipboardText).toContain('## Log: terminal-diagnostics.log')
      expect(clipboardText).toContain('## Log: pty-host.log')
    } finally {
      await electronApp.close()
    }
  })
})
