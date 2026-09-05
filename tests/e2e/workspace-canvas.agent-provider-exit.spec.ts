import { expect, test } from '@playwright/test'
import { clearAndSeedWorkspace, launchApp } from './workspace-canvas.helpers'
import { SELECTABLE_AGENT_PROVIDERS } from '../../src/contexts/settings/domain/agentSettings.providers'

test.describe('Workspace Canvas - dedicated Agent provider exit', () => {
  for (const provider of SELECTABLE_AGENT_PROVIDERS) {
    test(`${provider} keeps its node but replaces live status on PTY exit`, async ({
      browserName: _browserName,
    }, testInfo) => {
      const { electronApp, window } = await launchApp({
        windowMode: 'offscreen',
        env: { OPENCOVE_TEST_AGENT_SESSION_SCENARIO: 'raw-two-stage-ctrl-c' },
      })
      try {
        await clearAndSeedWorkspace(window, [], { settings: { defaultProvider: provider } })
        const pane = window.locator('.workspace-canvas .react-flow__pane')
        await pane.click({ button: 'right', position: { x: 320, y: 220 } })
        await window.getByTestId('workspace-context-run-default-agent').click()
        const terminal = window.locator('.terminal-node').first()
        const status = terminal.locator('.terminal-node__status')
        const transcript = terminal.locator('.terminal-node__transcript')
        await expect(transcript).toContainText(`[opencove-test-2c] ${provider} ready`)
        const priorStatus = await status.textContent()
        await terminal.locator('.xterm-helper-textarea').click()
        await window.keyboard.press('Control+C')
        await expect(transcript).toContainText(`${provider} cancel-alt-exit`)
        await expect(status).toHaveText(priorStatus ?? '')
        await expect(terminal.getByTestId('terminal-node-reload-session')).toBeVisible()

        await window.keyboard.press('Control+C')
        await expect(transcript).toContainText(`${provider} provider-exit`)
        await expect(status).toHaveText('Exited')
        await expect(window.locator('.workspace-agent-item__status--agent')).toHaveText('Standby')
        await expect(terminal.getByTestId('terminal-node-reload-session')).toBeVisible()
        await testInfo.attach(`${provider}-pty-exited`, {
          body: await terminal.screenshot({ path: testInfo.outputPath(`${provider}-exit.png`) }),
          contentType: 'image/png',
        })
      } finally {
        await electronApp.close()
      }
    })
  }
})
