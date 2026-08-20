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
      // Push the breadcrumb trail well past the per-section GitHub budget so
      // that which end survives truncation actually matters. Stays far below the
      // ring buffer capacity, so the redacted breadcrumb above is not evicted.
      await window.evaluate(() => {
        for (let index = 0; index < 40; index += 1) {
          window.opencoveApi.debug?.recordUiDiagnosticBreadcrumb({
            source: 'renderer-ui',
            event: 'canvas-geometry',
            details: { filler: index, canvasWidth: 960 + index, canvasHeight: 540 + index },
          })
        }
      })

      // Resize last, so `window-resize` is the newest breadcrumb: the one a
      // head-truncating extract would drop and a tail-truncating one must keep.
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

      // Whoever files the issue has to learn that the prefilled GitHub form is
      // only an extract, otherwise the saved report never gets attached.
      const subsetHint = window.locator('[data-testid="issue-report-github-subset-hint"]')
      await expect(subsetHint).toBeVisible()
      await expect(subsetHint).toContainText(/shortened extract|节选内容/u)

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

      // The prefilled GitHub body is a separate, much smaller document than the
      // saved report asserted above. The breadcrumb closest to the failure is
      // the reason a trail exists at all, so it has to survive into the URL that
      // actually reaches GitHub.
      const githubIssueUrl = await window.evaluate(
        async () =>
          (
            await window.opencoveApi.issueReport.prepare({
              kind: 'other',
              description: 'Prefilled GitHub body check.',
              includeLocalPaths: false,
            })
          ).githubIssueUrl,
      )
      expect(githubIssueUrl.length).toBeLessThanOrEqual(7_500)

      const githubBody = new URL(githubIssueUrl).searchParams.get('body') ?? ''
      expect(githubBody).toContain('#### UI Geometry')
      expect(githubBody).toContain('#### Diagnostic Breadcrumbs')
      expect(githubBody).not.toContain('github_pat_abcdefghijklmnopqrstuvwxyz')

      const breadcrumbPayload = githubBody
        .slice(githubBody.indexOf('#### Diagnostic Breadcrumbs'))
        .match(/```text\n([\s\S]*?)\n```/u)
      expect(breadcrumbPayload).not.toBeNull()
      const breadcrumbs = JSON.parse(breadcrumbPayload![1]!) as {
        count: number
        omittedEntries: number
        entries: { event: string }[]
      }
      expect(breadcrumbs.entries.length).toBeGreaterThan(0)
      expect(breadcrumbs.omittedEntries).toBe(breadcrumbs.count - breadcrumbs.entries.length)
      // `window-resize` is emitted by the real resize performed above, and it is
      // the newest breadcrumb, so it must be present rather than dropped.
      expect(breadcrumbs.entries.map(entry => entry.event)).toContain('window-resize')
    } finally {
      await electronApp.close()
    }
  })
})
