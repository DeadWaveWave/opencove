import { expect, test } from '@playwright/test'
import { execFile } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import {
  clearAndSeedWorkspace,
  createTestUserDataDir,
  launchApp,
  removePathWithRetry,
  testWorkspacePath,
} from './workspace-canvas.helpers'

const execFileAsync = promisify(execFile)

async function createGitWorktree(payload: {
  branchName: string
  worktreePath: string
}): Promise<void> {
  await mkdir(path.dirname(payload.worktreePath), { recursive: true })
  await execFileAsync(
    'git',
    ['worktree', 'add', '-b', payload.branchName, payload.worktreePath, 'HEAD'],
    { cwd: testWorkspacePath },
  )
}

async function removeGitWorktree(payload: {
  branchName: string
  worktreePath: string
}): Promise<void> {
  try {
    await execFileAsync('git', ['worktree', 'remove', '--force', payload.worktreePath], {
      cwd: testWorkspacePath,
    })
  } catch {
    // ignore cleanup failures
  }

  try {
    await execFileAsync('git', ['branch', '-D', payload.branchName], { cwd: testWorkspacePath })
  } catch {
    // ignore cleanup failures
  }

  await removePathWithRetry(payload.worktreePath)
}

test.describe('Workspace Canvas - Space PR Chip', () => {
  test('shows PR chip link for worktree branch', async () => {
    const userDataDir = await createTestUserDataDir()
    const stamp = Date.now()
    const branchName = `e2e/pr-panel-${stamp}`
    const worktreeName = `wt-e2e-pr-panel-${stamp}`
    const worktreePath = path.join(testWorkspacePath, '.opencove', 'worktrees', worktreeName)

    await createGitWorktree({ branchName, worktreePath })

    try {
      const { electronApp, window } = await launchApp({
        windowMode: 'offscreen',
        userDataDir,
        cleanupUserDataDir: true,
        env: {
          OPENCOVE_TEST_GITHUB_INTEGRATION: '1',
        },
      })

      try {
        await clearAndSeedWorkspace(
          window,
          [
            {
              id: 'note-pr-panel',
              title: 'note',
              position: { x: 240, y: 220 },
              width: 420,
              height: 280,
              kind: 'note',
              task: { text: 'Space PR panel test.' },
            },
          ],
          {
            spaces: [
              {
                id: 'space-pr-panel',
                name: 'PR Space',
                directoryPath: worktreePath,
                nodeIds: ['note-pr-panel'],
                rect: { x: 180, y: 160, width: 620, height: 420 },
              },
            ],
            activeSpaceId: 'space-pr-panel',
          },
        )

        const chip = window.locator('[data-testid="workspace-space-pr-chip-space-pr-panel"]')
        await expect(chip).toBeVisible({ timeout: 15_000 })
        await expect(chip).toHaveAttribute('href', 'https://example.com/pull/123')
        await expect(chip).toHaveAttribute('target', '_blank')
        await expect(chip).toHaveAttribute('title', `Test PR for ${branchName} (#123)`)
        await expect(window.locator('[data-testid^="workspace-space-pr-panel-"]')).toHaveCount(0)
      } finally {
        await electronApp.close()
      }
    } finally {
      await removeGitWorktree({ branchName, worktreePath })
      await removePathWithRetry(userDataDir)
    }
  })
})
