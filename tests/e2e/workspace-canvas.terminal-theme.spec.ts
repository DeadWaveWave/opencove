import { expect, test } from '@playwright/test'
import {
  clearAndSeedWorkspace,
  launchApp,
  selectCoveOption,
  testWorkspacePath,
} from './workspace-canvas.helpers'

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

  test('keeps opencode agent terminal theme synchronized after switching ui theme', async ({
    browserName,
  }, testInfo) => {
    const { electronApp, window } = await launchApp()

    try {
      void browserName
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'node-opencode-theme',
            title: 'opencode · qwen',
            position: { x: 160, y: 140 },
            width: 520,
            height: 320,
            kind: 'agent',
            status: 'running',
            startedAt: '2026-03-23T10:00:00.000Z',
            endedAt: null,
            exitCode: null,
            lastError: null,
            agent: {
              provider: 'opencode',
              prompt: 'Investigate theme sync behavior',
              model: 'qwen',
              effectiveModel: 'qwen',
              launchMode: 'new',
              resumeSessionId: 'session-opencode-theme',
              resumeSessionIdVerified: true,
              executionDirectory: testWorkspacePath,
              directoryMode: 'workspace',
              customDirectory: null,
              shouldCreateDirectory: false,
            },
          },
        ],
        {
          settings: {
            uiTheme: 'dark',
          },
        },
      )

      const terminalNode = window.locator('.terminal-node').first()
      const terminalHeader = terminalNode.locator('.terminal-node__header')
      const terminalBody = terminalNode.locator('.terminal-node__terminal')

      await expect(terminalBody).toBeVisible()
      await expect(terminalNode).toHaveAttribute('data-cove-terminal-node-theme', 'dark')
      await expect(terminalBody).toHaveAttribute('data-cove-terminal-theme', 'dark')
      await expect(terminalHeader).toHaveCSS('background-color', 'rgba(18, 28, 50, 0.96)')

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

      await expect(terminalNode).toHaveAttribute('data-cove-terminal-node-theme', 'light')
      await expect(terminalBody).toHaveAttribute('data-cove-terminal-theme', 'light')
      await expect(terminalHeader).toHaveCSS('background-color', 'rgba(246, 249, 255, 0.96)')

      await window.locator('.settings-panel__close').click()

      const screenshotPath = testInfo.outputPath('terminal-opencode-theme-light.png')
      await window.screenshot({ path: screenshotPath })
      await testInfo.attach('terminal-opencode-theme-light', {
        path: screenshotPath,
        contentType: 'image/png',
      })
    } finally {
      await electronApp.close()
    }
  })
})
