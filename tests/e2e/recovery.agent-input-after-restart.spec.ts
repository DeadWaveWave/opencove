import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  clearAndSeedWorkspace,
  createTestUserDataDir,
  launchApp,
  removePathWithRetry,
} from './workspace-canvas.helpers'

async function launchAgentsFromTasks(window: Page, count: number): Promise<void> {
  const runButtons = window.locator('[data-testid="task-node-run-agent"]')

  const launchNextAgent = async (index: number): Promise<void> => {
    if (index >= count) {
      return
    }

    await expect(runButtons.nth(index)).toBeVisible()
    await runButtons.nth(index).click()
    await expect(window.locator('.terminal-node')).toHaveCount(index + 1)
    await launchNextAgent(index + 1)
  }

  await launchNextAgent(0)
}

async function verifyRecoveredAgentNodeInteractive(window: Page, nodeIndex: number): Promise<void> {
  const fitView = window.locator('.react-flow__controls-fitview').first()
  const agentNode = window.locator('.terminal-node').nth(nodeIndex)
  const nodeStatus = agentNode.locator('.terminal-node__status')
  const helper = agentNode.locator('.xterm-helper-textarea')

  await expect(fitView).toBeVisible()
  await fitView.click()
  await expect(agentNode).toBeVisible()
  await expect(nodeStatus).toHaveText('Standby')
  await expect(agentNode.locator('.terminal-node__terminal')).toHaveAttribute('aria-busy', 'false')

  await agentNode.locator('.xterm').click()
  await expect(helper).toBeFocused()
  await window.waitForTimeout(1800)
  await expect(helper).toBeFocused()

  await window.keyboard.press('Enter')

  await expect(nodeStatus).toHaveText('Working', { timeout: 5000 })
  await expect(nodeStatus).toHaveText('Standby', { timeout: 15_000 })
}

async function verifyStatusesStandby(statuses: Locator, count: number): Promise<void> {
  await Promise.all(
    Array.from({ length: count }, async (_, index) => {
      await expect(statuses.nth(index)).toHaveText('Standby')
    }),
  )
}

async function runRecoveredInteractionRounds(
  window: Page,
  agentCount: number,
  interactionRounds: number,
): Promise<void> {
  const runRound = async (roundIndex: number): Promise<void> => {
    if (roundIndex >= interactionRounds) {
      return
    }

    const runNode = async (nodeIndex: number): Promise<void> => {
      if (nodeIndex >= agentCount) {
        return
      }

      await verifyRecoveredAgentNodeInteractive(window, nodeIndex)
      await runNode(nodeIndex + 1)
    }

    await runNode(0)
    await runRound(roundIndex + 1)
  }

  await runRound(0)
}

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

  test('keeps multiple restored agents interactive across repeated focus rounds after restart', async () => {
    const userDataDir = await createTestUserDataDir()
    const agentCount = 3
    const interactionRounds = 2

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
        await clearAndSeedWorkspace(
          window,
          Array.from({ length: agentCount }, (_, index) => ({
            id: `recovery-agent-input-task-${index + 1}`,
            title: `Recovery task ${index + 1}`,
            position: { x: 120 + index * 360, y: 120 + index * 90 },
            width: 320,
            height: 220,
            kind: 'task' as const,
            task: {
              requirement: `Verify recovered agent input ${index + 1}`,
              status: 'todo' as const,
              linkedAgentNodeId: null,
              lastRunAt: null,
              autoGeneratedTitle: false,
              createdAt: '2026-03-08T00:00:00.000Z',
              updatedAt: '2026-03-08T00:00:00.000Z',
            },
          })),
          {
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
          },
        )

        await expect(window.locator('.task-node')).toHaveCount(agentCount)
        await launchAgentsFromTasks(window, agentCount)

        const statuses = window.locator('.terminal-node__status')
        await expect(statuses).toHaveCount(agentCount)
        await verifyStatusesStandby(statuses, agentCount)
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
        await expect(restartedWindow.locator('.terminal-node')).toHaveCount(agentCount, {
          timeout: 30_000,
        })

        await runRecoveredInteractionRounds(restartedWindow, agentCount, interactionRounds)
      } finally {
        await restartedApp.close()
      }
    } finally {
      await removePathWithRetry(userDataDir)
    }
  })
})
