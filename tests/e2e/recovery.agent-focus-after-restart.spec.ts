import { expect, test, type Locator } from '@playwright/test'
import {
  clearAndSeedWorkspace,
  createTestUserDataDir,
  launchApp,
  removePathWithRetry,
} from './workspace-canvas.helpers'

async function expectObservedWorkingTransition(
  status: Locator,
  timeoutMs = 5_000,
  intervalMs = 75,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  const samples: string[] = []

  while (Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop -- bounded UI polling
    const text = ((await status.textContent()) ?? '').trim()
    samples.push(text)
    if (text === 'Working') {
      return
    }
    // eslint-disable-next-line no-await-in-loop -- bounded UI polling
    await status.page().waitForTimeout(intervalMs)
  }

  expect(
    samples.some(sample => sample === 'Working'),
    `Expected to observe a transient Working state, saw: ${JSON.stringify(samples)}`,
  ).toBe(true)
}

test.describe('Recovery - Agent focus after restart', () => {
  test('keeps restored agent terminal focused long enough to type after restart', async () => {
    const userDataDir = await createTestUserDataDir()

    try {
      const { electronApp, window } = await launchApp({
        windowMode: 'offscreen',
        userDataDir,
        cleanupUserDataDir: false,
        env: {
          OPENCOVE_TEST_ENABLE_SESSION_STATE_WATCHER: '1',
          OPENCOVE_TEST_AGENT_SESSION_SCENARIO: 'jsonl-stdin-submit-driven-turn',
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
          OPENCOVE_TEST_AGENT_SESSION_SCENARIO: 'jsonl-stdin-submit-driven-turn',
        },
      })

      try {
        const agentNode = restartedWindow.locator('.terminal-node').first()
        const nodeStatus = agentNode.locator('.terminal-node__status')
        const helper = agentNode.locator('.xterm-helper-textarea')

        await expect(agentNode).toBeVisible()
        await expect(nodeStatus).toHaveText('Standby')
        await expect(agentNode.locator('.terminal-node__terminal')).toHaveAttribute(
          'aria-busy',
          'false',
        )

        await agentNode.locator('.xterm').click()
        await expect(helper).toBeFocused()
        await restartedWindow.waitForTimeout(1800)
        await expect(helper).toBeFocused()

        await restartedWindow.keyboard.press('Enter')

        await expectObservedWorkingTransition(nodeStatus)
        await expect(nodeStatus).toHaveText('Standby', { timeout: 15_000 })
      } finally {
        await restartedApp.close()
      }
    } finally {
      await removePathWithRetry(userDataDir)
    }
  })
})
