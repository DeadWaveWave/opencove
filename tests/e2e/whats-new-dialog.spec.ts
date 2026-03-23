import { expect, test } from '@playwright/test'
import path from 'path'
import { launchApp } from './workspace-canvas.helpers'

test.describe('Whats New', () => {
  test('shows the update changelog dialog after first launch', async ({
    browserName,
  }, testInfo) => {
    const { electronApp, window } = await launchApp({
      env: {
        OPENCOVE_TEST_WHATS_NEW: '1',
        OPENCOVE_TEST_RELEASE_NOTES_FIXTURE: '1',
      },
    })

    try {
      void browserName
      const resetResult = await window.evaluate(async () => {
        return await window.opencoveApi.persistence.writeWorkspaceStateRaw({
          raw: JSON.stringify({
            formatVersion: 1,
            activeWorkspaceId: null,
            workspaces: [],
            settings: {
              language: 'zh-CN',
              uiTheme: 'light',
              releaseNotesSeenVersion: '0.1.9',
            },
          }),
        })
      })

      if (!resetResult.ok) {
        throw new Error(
          `Failed to reset workspace state: ${resetResult.reason}: ${resetResult.error.code}${
            resetResult.error.debugMessage ? `: ${resetResult.error.debugMessage}` : ''
          }`,
        )
      }

      await window.reload({ waitUntil: 'domcontentloaded' })

      const dialog = window.locator('[data-testid="whats-new-dialog"]')
      await expect(dialog).toBeVisible()
      await expect(window.locator('.whats-new-header h3')).toHaveText('更新内容')
      await expect(window.locator('.whats-new-compare-link')).toHaveText('在 GitHub 查看完整对比')

      const screenshotPath = path.resolve(
        __dirname,
        '../../test-results/whats-new-dialog.zh-CN.png',
      )
      await window.screenshot({ path: screenshotPath })

      await testInfo.attach('whats-new-dialog.zh-CN', {
        path: screenshotPath,
        contentType: 'image/png',
      })
    } finally {
      await electronApp.close()
    }
  })
})
