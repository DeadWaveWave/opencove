import { expect, test } from '@playwright/test'
import { launchApp } from './workspace-canvas.helpers'

test.describe('Issue report', () => {
  test('generates a report from the header dialog', async () => {
    const { electronApp, window } = await launchApp()

    try {
      const userDataPath = await electronApp.evaluate(({ app }) => app.getPath('userData'))
      const initialInnerWidth = await window.evaluate(() => window.innerWidth)
      await window.evaluate(
        ({ localPath, token }) => {
          window.opencoveApi.debug?.recordUiDiagnosticBreadcrumb({
            source: 'renderer-ui',
            event: 'canvas-geometry',
            details: { localPath, token, canvasWidth: 960 },
          })
        },
        {
          localPath: userDataPath,
          token: 'github_pat_abcdefghijklmnopqrstuvwxyz',
        },
      )
      await electronApp.evaluate(({ BrowserWindow }) => {
        const appWindow = BrowserWindow.getAllWindows()[0]
        const [width, height] = appWindow?.getSize() ?? [1280, 800]
        appWindow?.setSize(Math.max(800, width - 32), height)
      })
      await expect
        .poll(async () => await window.evaluate(() => window.innerWidth))
        .not.toBe(initialInnerWidth)

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
      expect(clipboardText).toContain('## UI Geometry')
      expect(clipboardText).toContain('## Diagnostic Breadcrumbs')
      expect(clipboardText).toContain('"event": "window-resize"')
      expect(clipboardText).toContain('"devicePixelRatio":')
      expect(clipboardText).toContain('"zoomFactor":')
      expect(clipboardText).toContain('## Log: runtime-diagnostics.log')
      expect(clipboardText).toContain('## Log: pty-host.log')
      expect(clipboardText).not.toContain('## Log: terminal-diagnostics.log')
      expect(clipboardText).not.toContain('github_pat_abcdefghijklmnopqrstuvwxyz')
      expect(clipboardText).not.toContain(userDataPath)
      expect(clipboardText).toContain('[redacted]')
      expect(clipboardText).toContain('[local-path]')
    } finally {
      await electronApp.close()
    }
  })
})
