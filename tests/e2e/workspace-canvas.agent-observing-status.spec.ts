import { expect, test } from '@playwright/test'
import { clearAndSeedWorkspace, launchApp, testWorkspacePath } from './workspace-canvas.helpers'

test.describe('Workspace Canvas - Agent observing status', () => {
  test('shows observing only on an agent node without runtime evidence', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(window, [
        {
          id: 'plain-terminal',
          title: 'plain terminal',
          position: { x: 180, y: 140 },
          width: 460,
          height: 300,
          kind: 'terminal',
          status: null,
        },
        {
          id: 'pi-observing',
          title: 'Pi · observing',
          position: { x: 700, y: 140 },
          width: 460,
          height: 300,
          kind: 'agent',
          status: null,
          startedAt: null,
          endedAt: null,
          exitCode: null,
          lastError: null,
          agent: {
            provider: 'pi',
            prompt: 'Synthetic prompt prevents blank-session relaunch.',
            model: null,
            effectiveModel: null,
            launchMode: 'new',
            resumeSessionId: null,
            resumeSessionIdVerified: false,
            executionDirectory: testWorkspacePath,
            expectedDirectory: testWorkspacePath,
            directoryMode: 'workspace',
            customDirectory: null,
            shouldCreateDirectory: false,
          },
        },
      ])

      const nodes = window.locator('.terminal-node')
      await expect(nodes).toHaveCount(2)

      const agentNode = nodes.filter({ has: window.locator('.terminal-node__status') })
      const plainTerminal = nodes.filter({ hasNot: window.locator('.terminal-node__status') })

      await expect(agentNode.locator('.terminal-node__status')).toHaveText('Observing')
      await expect(agentNode.locator('.terminal-node__status')).toHaveClass(
        /terminal-node__status--observing/u,
      )
      await expect(plainTerminal.locator('.terminal-node__status')).toHaveCount(0)
    } finally {
      await electronApp.close()
    }
  })
})
