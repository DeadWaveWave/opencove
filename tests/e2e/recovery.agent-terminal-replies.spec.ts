import { expect, test } from '@playwright/test'
import {
  clearAndSeedWorkspace,
  createTestUserDataDir,
  launchApp,
  removePathWithRetry,
} from './workspace-canvas.helpers'

test.describe('Recovery - Agent terminal replies', () => {
  test('does not echo delayed xterm replies as visible ^[[ garbage after restart', async () => {
    const userDataDir = await createTestUserDataDir()

    try {
      const { electronApp, window } = await launchApp({
        windowMode: 'offscreen',
        userDataDir,
        cleanupUserDataDir: false,
        env: {
          OPENCOVE_TEST_AGENT_SESSION_SCENARIO: 'raw-dsr-reply-echo',
        },
      })

      try {
        await clearAndSeedWorkspace(window, [], {
          settings: {
            defaultProvider: 'codex',
            customModelEnabledByProvider: {
              'claude-code': false,
              codex: true,
            },
            customModelByProvider: {
              'claude-code': '',
              codex: 'gpt-5.2-codex',
            },
            customModelOptionsByProvider: {
              'claude-code': [],
              codex: ['gpt-5.2-codex'],
            },
          },
        })

        const pane = window.locator('.workspace-canvas .react-flow__pane')
        await expect(pane).toBeVisible()

        await pane.click({
          button: 'right',
          position: { x: 320, y: 220 },
        })

        const runButton = window.locator('[data-testid="workspace-context-run-default-agent"]')
        await expect(runButton).toBeVisible()
        await runButton.click()

        const terminalNode = window.locator('.terminal-node').first()
        await expect(terminalNode).toContainText('[opencove-test-dsr] done', { timeout: 20_000 })
        await expect(terminalNode).not.toContainText('^[[1;1R')
      } finally {
        await electronApp.close()
      }

      const { electronApp: restartedApp, window: restartedWindow } = await launchApp({
        windowMode: 'offscreen',
        userDataDir,
        cleanupUserDataDir: true,
        env: {
          OPENCOVE_TEST_AGENT_SESSION_SCENARIO: 'raw-dsr-reply-echo',
        },
      })

      try {
        await expect(restartedWindow.locator('.terminal-node')).toHaveCount(1)
        const terminalNode = restartedWindow.locator('.terminal-node').first()
        await expect(terminalNode).toContainText('[opencove-test-dsr] done', { timeout: 20_000 })
        await expect(terminalNode).not.toContainText('^[[1;1R')
      } finally {
        await restartedApp.close()
      }
    } finally {
      await removePathWithRetry(userDataDir)
    }
  })
})
