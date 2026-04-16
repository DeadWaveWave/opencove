import { expect, test } from '@playwright/test'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import {
  buildNodeEvalCommand,
  clearAndSeedWorkspace,
  createTestUserDataDir,
  launchApp,
  removePathWithRetry,
} from './workspace-canvas.helpers'
import { resolveTestAgentStubScriptPath, startWorker, stopWorker } from './worker-client.helpers'

test.describe('Recovery - Worker client input after restart', () => {
  test('remains interactive for both terminal and agent sessions after app restart', async () => {
    const userDataDir = await createTestUserDataDir()
    let workerChild: ChildProcessWithoutNullStreams | null = null

    try {
      const worker = await startWorker({
        userDataDir,
        env: {
          NODE_ENV: 'test',
          OPENCOVE_TEST_AGENT_STUB_SCRIPT: resolveTestAgentStubScriptPath(),
          OPENCOVE_TEST_AGENT_SESSION_SCENARIO: 'stdin-echo',
        },
      })
      workerChild = worker.child

      const { electronApp, window } = await launchApp({
        windowMode: 'offscreen',
        userDataDir,
        cleanupUserDataDir: false,
        env: {
          OPENCOVE_WORKER_CLIENT: '1',
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

        await pane.click({ button: 'right', position: { x: 220, y: 180 } })
        const newTerminal = window.locator('[data-testid="workspace-context-new-terminal"]')
        await expect(newTerminal).toBeVisible()
        await newTerminal.click()
        await expect(window.locator('.terminal-node')).toHaveCount(1)

        await pane.click({ button: 'right', position: { x: 320, y: 240 } })
        const runAgent = window.locator('[data-testid="workspace-context-run-default-agent"]')
        await expect(runAgent).toBeVisible()
        await runAgent.click()

        await expect(window.locator('.terminal-node')).toHaveCount(2)
      } finally {
        await electronApp.close()
      }

      const { electronApp: restartedApp, window: restartedWindow } = await launchApp({
        windowMode: 'offscreen',
        userDataDir,
        cleanupUserDataDir: false,
        env: {
          OPENCOVE_WORKER_CLIENT: '1',
        },
      })

      try {
        await expect(restartedWindow.locator('.terminal-node')).toHaveCount(2, { timeout: 30_000 })

        const agentNode = restartedWindow
          .locator('.terminal-node')
          .filter({ has: restartedWindow.locator('.terminal-node__status') })
          .first()
        const terminalNode = restartedWindow
          .locator('.terminal-node')
          .filter({ hasNot: restartedWindow.locator('.terminal-node__status') })
          .first()

        await expect(agentNode).toBeVisible()
        await expect(agentNode.locator('.xterm')).toBeVisible()
        await expect(agentNode.locator('.terminal-node__terminal')).toHaveAttribute(
          'aria-busy',
          'false',
        )

        await expect(terminalNode).toBeVisible()
        await expect(terminalNode.locator('.xterm')).toBeVisible()
        await expect(terminalNode.locator('.terminal-node__terminal')).toHaveAttribute(
          'aria-busy',
          'false',
        )

        const terminalToken = `OPENCOVE_WORKER_TERMINAL_INPUT_${Date.now()}`
        await terminalNode.locator('.xterm').click()
        await expect(terminalNode.locator('.xterm-helper-textarea')).toBeFocused()
        await restartedWindow.waitForTimeout(250)
        await restartedWindow.keyboard.type(
          buildNodeEvalCommand(`process.stdout.write(${JSON.stringify(terminalToken)} + '\\n')`),
        )
        await restartedWindow.keyboard.press('Enter')
        await expect(terminalNode).toContainText(terminalToken)

        await agentNode.locator('.xterm').click()
        await expect(agentNode.locator('.xterm-helper-textarea')).toBeFocused()
        await restartedWindow.waitForTimeout(250)
        await expect(agentNode).not.toContainText('stdin_hex=')
        await restartedWindow.keyboard.press('Enter')
        await expect(agentNode).toContainText(/stdin_hex=(0d0a|0d|0a)/, { timeout: 10_000 })
      } finally {
        await restartedApp.close()
      }
    } finally {
      await stopWorker(workerChild)
      await removePathWithRetry(userDataDir)
    }
  })
})
