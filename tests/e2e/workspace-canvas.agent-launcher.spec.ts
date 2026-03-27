import { expect, test } from '@playwright/test'
import { clearAndSeedWorkspace, launchApp } from './workspace-canvas.helpers'

test.describe('Workspace Canvas - Agent Launcher', () => {
  test('runs default agent directly and creates node', async () => {
    const { electronApp, window } = await launchApp({ windowMode: 'offscreen' })

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

      const launcher = window.locator('[data-testid="workspace-agent-launcher"]')
      await expect(launcher).toHaveCount(0)

      await expect(window.locator('.terminal-node')).toHaveCount(1)
      await expect(window.locator('.terminal-node__title').first()).toContainText('gpt-5.2-codex')
      await expect(window.locator('.terminal-node').first().locator('.xterm')).toBeVisible()
      await expect(window.locator('.terminal-node').first()).toContainText(
        '[opencove-test-agent] codex new',
      )
      await expect(window.locator('.workspace-sidebar .workspace-agent-item')).toHaveCount(1)
      await expect(
        window.locator(
          '.workspace-sidebar .workspace-agent-item .workspace-agent-item__status--agent',
        ),
      ).toHaveText('Standby')
    } finally {
      await electronApp.close()
    }
  })
})
