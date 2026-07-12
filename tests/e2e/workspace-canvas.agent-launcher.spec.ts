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

  test('renames a directly launched Agent from its first session message', async ({
    browserName: _browserName,
  }, testInfo) => {
    const { electronApp, window } = await launchApp({
      windowMode: 'offscreen',
      env: {
        OPENCOVE_TEST_ENABLE_SESSION_STATE_WATCHER: '1',
        OPENCOVE_TEST_AGENT_SESSION_SCENARIO: 'codex-title-from-first-input',
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
      await pane.click({ button: 'right', position: { x: 320, y: 220 } })
      await window.locator('[data-testid="workspace-context-run-default-agent"]').click()

      const agentNode = window.locator('.terminal-node').first()
      const title = agentNode.locator('[data-testid="terminal-node-title-display"]')
      const terminalInput = agentNode.locator('.xterm-helper-textarea')
      await expect(agentNode).toBeVisible()
      await expect(title).toContainText('gpt-5.2-codex')

      await terminalInput.focus()
      await expect(terminalInput).toBeFocused()
      await window.keyboard.type('Rename direct Agent windows')
      await window.keyboard.press('Enter')

      await expect(title).toHaveText('codex · Rename direct Agent windows', { timeout: 15_000 })
      const completionNotification = window
        .locator('[data-testid="app-notifications"] .app-notification')
        .first()
      await expect(completionNotification).toBeVisible({ timeout: 15_000 })
      await expect(completionNotification.locator('.app-notification__title')).toHaveText(
        'codex · Rename direct Agent windows',
      )
      await expect
        .poll(async () => {
          return await window.evaluate(async () => {
            const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
            if (!raw) {
              return null
            }

            const state = JSON.parse(raw) as {
              workspaces?: Array<{ nodes?: Array<{ title?: string }> }>
            }
            return state.workspaces?.[0]?.nodes?.[0]?.title ?? null
          })
        })
        .toBe('codex · Rename direct Agent windows')

      await testInfo.attach('direct-agent-session-title', {
        body: await window.screenshot(),
        contentType: 'image/png',
      })
    } finally {
      await electronApp.close()
    }
  })
})
