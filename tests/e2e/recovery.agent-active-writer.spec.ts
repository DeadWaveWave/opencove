import { expect, test } from '@playwright/test'
import {
  clearAndSeedWorkspace,
  createTestUserDataDir,
  launchApp,
  removePathWithRetry,
  testWorkspacePath,
} from './workspace-canvas.helpers'

test.describe('Recovery - Agent active writer', () => {
  test('keeps the Agent recoverable and presents a retry action after bounded retries', async () => {
    const userDataDir = await createTestUserDataDir()

    try {
      const { electronApp, window } = await launchApp({
        windowMode: 'offscreen',
        userDataDir,
        cleanupUserDataDir: true,
        env: {
          OPENCOVE_TEST_AGENT_SESSION_SCENARIO: 'codex-active-writer',
        },
      })

      try {
        await clearAndSeedWorkspace(window, [
          {
            id: 'agent-writer-locked',
            title: 'codex',
            position: { x: 160, y: 140 },
            width: 520,
            height: 360,
            kind: 'agent',
            status: 'running',
            startedAt: '2026-08-15T00:00:00.000Z',
            endedAt: null,
            exitCode: null,
            lastError: null,
            executionDirectory: testWorkspacePath,
            expectedDirectory: testWorkspacePath,
            agent: {
              provider: 'codex',
              prompt: '',
              model: null,
              effectiveModel: null,
              launchMode: 'resume',
              resumeSessionId: 'thread-writer-locked',
              resumeSessionIdVerified: true,
              executionDirectory: testWorkspacePath,
              expectedDirectory: testWorkspacePath,
              directoryMode: 'workspace',
              customDirectory: null,
              shouldCreateDirectory: false,
            },
          },
        ])

        const agentNode = window.locator('.terminal-node').first()
        const recoveryIssue = agentNode.locator('.terminal-node__recovery-issue')
        await expect(recoveryIssue).toBeVisible({ timeout: 15_000 })
        await expect(recoveryIssue).toContainText('Another writer is still closing')
        await expect(recoveryIssue.getByRole('button', { name: 'Retry recovery' })).toBeVisible()
        await expect(agentNode.locator('.terminal-node__status')).toHaveText('Standby')

        const persisted = await window.evaluate(async () => {
          const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
          const state = raw
            ? (JSON.parse(raw) as { workspaces?: Array<{ nodes?: unknown[] }> })
            : null
          return state?.workspaces?.[0]?.nodes?.[0] ?? null
        })
        expect(persisted).toMatchObject({
          kind: 'agent',
          agent: {
            resumeSessionId: 'thread-writer-locked',
            resumeSessionIdVerified: true,
          },
        })
        expect(persisted).not.toHaveProperty('recoveryIssue')
      } finally {
        await electronApp.close()
      }
    } finally {
      await removePathWithRetry(userDataDir)
    }
  })
})
