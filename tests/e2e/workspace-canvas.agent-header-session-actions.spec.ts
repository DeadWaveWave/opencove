import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import {
  createTestUserDataDir,
  launchApp,
  seedWorkspaceState,
  testWorkspacePath,
} from './workspace-canvas.helpers'

async function seedCodexSessions(userDataDir: string): Promise<void> {
  const sessionDirectory = path.join(userDataDir, 'home', '.codex', 'sessions', '2026', '04', '29')
  await mkdir(sessionDirectory, { recursive: true })

  const currentRecord = JSON.stringify({
    type: 'session_meta',
    timestamp: '2026-04-29T00:10:00.000Z',
    payload: {
      id: 'resume-current',
      cwd: testWorkspacePath,
      timestamp: '2026-04-29T00:10:00.000Z',
    },
  })

  const targetRecord = JSON.stringify({
    type: 'session_meta',
    timestamp: '2026-04-29T00:30:00.000Z',
    payload: {
      id: 'resume-target',
      cwd: testWorkspacePath,
      timestamp: '2026-04-29T00:30:00.000Z',
    },
  })

  await writeFile(
    path.join(sessionDirectory, 'rollout-current.jsonl'),
    `${currentRecord}\n`,
    'utf8',
  )
  await writeFile(path.join(sessionDirectory, 'rollout-target.jsonl'), `${targetRecord}\n`, 'utf8')
}

test.describe('Workspace Canvas - Agent Header Session Actions', () => {
  test('shows header actions and loads current-project sessions', async () => {
    const userDataDir = await createTestUserDataDir()
    await seedCodexSessions(userDataDir)

    const { electronApp, window } = await launchApp({ userDataDir })

    try {
      await seedWorkspaceState(window, {
        activeWorkspaceId: 'workspace-agent-header-actions',
        workspaces: [
          {
            id: 'workspace-agent-header-actions',
            name: 'workspace-agent-header-actions',
            path: testWorkspacePath,
            nodes: [
              {
                id: 'agent-session-actions-node',
                title: 'codex · gpt-5.2-codex',
                position: { x: 180, y: 180 },
                width: 520,
                height: 380,
                kind: 'agent',
                status: 'standby',
                startedAt: '2026-04-29T00:00:00.000Z',
                agent: {
                  provider: 'codex',
                  prompt: 'Inspect agent session actions',
                  model: 'gpt-5.2-codex',
                  effectiveModel: 'gpt-5.2-codex',
                  launchMode: 'resume',
                  resumeSessionId: 'resume-current',
                  resumeSessionIdVerified: true,
                  executionDirectory: testWorkspacePath,
                  expectedDirectory: testWorkspacePath,
                  directoryMode: 'workspace',
                  customDirectory: null,
                  shouldCreateDirectory: false,
                },
              },
            ],
          },
        ],
      })

      const agentNode = window.locator('.terminal-node').first()
      await expect(agentNode).toBeVisible()
      await expect(agentNode.locator('[data-testid="terminal-node-reload-session"]')).toBeVisible()
      await expect(agentNode.locator('[data-testid="terminal-node-session-list"]')).toBeVisible()

      await agentNode.locator('[data-testid="terminal-node-session-list"]').click()

      const sessionMenu = window.locator('[data-testid="terminal-node-session-menu"]')
      await expect(sessionMenu).toBeVisible()
      await expect(
        window.locator('[data-testid="terminal-node-session-menu-item-resume-current"]'),
      ).toBeDisabled()
      await expect(
        window.locator('[data-testid="terminal-node-session-menu-item-resume-target"]'),
      ).toBeVisible()
    } finally {
      await electronApp.close()
    }
  })
})
