import { expect, test } from '@playwright/test'
import {
  clearAndSeedWorkspace,
  createTestUserDataDir,
  launchApp,
  removePathWithRetry,
} from './workspace-canvas.helpers'

test.describe('Recovery - Agent input after restart', () => {
  test('remains interactive (stdin forwarded) after app restart', async () => {
    const userDataDir = await createTestUserDataDir()

    try {
      const { electronApp, window } = await launchApp({
        windowMode: 'offscreen',
        userDataDir,
        cleanupUserDataDir: false,
        env: {
          OPENCOVE_TEST_ENABLE_SESSION_STATE_WATCHER: '1',
          OPENCOVE_TEST_AGENT_SESSION_SCENARIO: 'jsonl-stdin-submit-delayed-turn',
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
        await pane.click({ button: 'right', position: { x: 320, y: 220 } })

        const runButton = window.locator('[data-testid="workspace-context-run-default-agent"]')
        await expect(runButton).toBeVisible()
        await runButton.click()

        const agentNode = window.locator('.terminal-node').first()
        await expect(agentNode).toBeVisible()
        await expect(agentNode.locator('.terminal-node__status')).toHaveText('Standby')
      } finally {
        await electronApp.close()
      }

      const { electronApp: restartedApp, window: restartedWindow } = await launchApp({
        windowMode: 'offscreen',
        userDataDir,
        cleanupUserDataDir: true,
        env: {
          OPENCOVE_TEST_ENABLE_SESSION_STATE_WATCHER: '1',
          OPENCOVE_TEST_AGENT_SESSION_SCENARIO: 'jsonl-stdin-submit-delayed-turn',
        },
      })

      try {
        const agentNode = restartedWindow.locator('.terminal-node').first()
        const nodeStatus = agentNode.locator('.terminal-node__status')

        await expect(agentNode).toBeVisible()
        await expect(nodeStatus).toHaveText('Standby')
        await expect(agentNode.locator('.terminal-node__terminal')).toHaveAttribute(
          'aria-busy',
          'false',
        )

        await agentNode.locator('.xterm').click()
        await expect(agentNode.locator('.xterm-helper-textarea')).toBeFocused()
        await restartedWindow.waitForTimeout(250)
        await restartedWindow.keyboard.press('Enter')

        await expect(nodeStatus).toHaveText('Working', { timeout: 5000 })
        await expect(nodeStatus).toHaveText('Standby', { timeout: 15_000 })
      } finally {
        await restartedApp.close()
      }
    } finally {
      await removePathWithRetry(userDataDir)
    }
  })
})
