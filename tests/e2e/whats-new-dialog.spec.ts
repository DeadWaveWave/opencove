import { expect, test } from '@playwright/test'
import path from 'path'
import { launchApp } from './workspace-canvas.helpers'

test.describe('Whats New', () => {
  test('shows the update changelog dialog after first launch', async ({
    browserName,
  }, testInfo) => {
    const releaseManifestPath = path.resolve(
      __dirname,
      '../fixtures/release-notes/release-manifest.fixture.json',
    )
    const { electronApp, window } = await launchApp({
      env: {
        OPENCOVE_TEST_WHATS_NEW: '1',
        OPENCOVE_RELEASE_NOTES_MANIFEST_PATH: releaseManifestPath,
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
      await window.waitForFunction(() => {
        const body = document.querySelector('.whats-new-body')
        return Boolean(body) && !body.textContent?.includes('正在加载更新内容')
      })

      const dialog = window.locator('[data-testid="whats-new-dialog"]')
      await expect(dialog).toBeVisible()
      await expect(window.locator('.whats-new-header h3')).toHaveText('更新内容')
      await expect(window.locator('.whats-new-body')).toContainText('这个版本包含新的更新内容弹窗')
      await expect(window.locator('.whats-new-compare-link')).toHaveText('在 GitHub 查看此版本')

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

  test('does not show the dialog on a fresh install', async () => {
    const releaseManifestPath = path.resolve(
      __dirname,
      '../fixtures/release-notes/release-manifest.fixture.json',
    )
    const { electronApp, window } = await launchApp({
      env: {
        OPENCOVE_TEST_WHATS_NEW: '1',
        OPENCOVE_RELEASE_NOTES_MANIFEST_PATH: releaseManifestPath,
      },
    })

    try {
      await expect(window.locator('[data-testid="whats-new-dialog"]')).toHaveCount(0)
    } finally {
      await electronApp.close()
    }
  })
})
