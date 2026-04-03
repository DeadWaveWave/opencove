import { expect, test } from '@playwright/test'
import { execFile } from 'node:child_process'
import { mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { launchApp, removePathWithRetry, seedWorkspaceState } from './workspace-canvas.helpers'

const execFileAsync = promisify(execFile)

async function runGit(args: string[], cwd: string): Promise<void> {
  await execFileAsync('git', args, {
    cwd,
    env: process.env,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  })
}

async function createTempRepo(): Promise<string> {
  const repoDir = await mkdtemp(path.join(tmpdir(), 'opencove-worktree-branches-e2e-'))

  await runGit(['init'], repoDir)
  await runGit(['config', 'user.email', 'test@example.com'], repoDir)
  await runGit(['config', 'user.name', 'OpenCove Test'], repoDir)
  await runGit(['config', 'core.autocrlf', 'false'], repoDir)
  await runGit(['config', 'core.safecrlf', 'false'], repoDir)
  await writeFile(path.join(repoDir, 'README.md'), '# temp\n', 'utf8')
  await runGit(['add', '.'], repoDir)
  await runGit(['commit', '-m', 'init'], repoDir)

  return await realpath(repoDir)
}

test.describe('Workspace Canvas - Worktree Branches', () => {
  test('loads git branches in the Space Worktree window', async () => {
    let repoPath = ''

    try {
      repoPath = await createTempRepo()

      const { electronApp, window } = await launchApp({
        windowMode: 'offscreen',
        env: {
          OPENCOVE_TEST_WORKSPACE: repoPath,
        },
      })

      try {
        await seedWorkspaceState(window, {
          activeWorkspaceId: 'workspace-worktree-branches',
          workspaces: [
            {
              id: 'workspace-worktree-branches',
              name: path.basename(repoPath),
              path: repoPath,
              nodes: [
                {
                  id: 'note-worktree-branches',
                  title: 'Worktree Branches',
                  position: { x: 220, y: 180 },
                  width: 320,
                  height: 220,
                  kind: 'note',
                  task: { text: 'seed' },
                },
              ],
              spaces: [
                {
                  id: 'space-worktree-root',
                  name: 'Root Space',
                  directoryPath: repoPath,
                  nodeIds: ['note-worktree-branches'],
                  rect: { x: 180, y: 140, width: 620, height: 420 },
                },
              ],
              activeSpaceId: 'space-worktree-root',
            },
          ],
        })

        await expect(window.locator('.note-node').first()).toBeVisible()

        await window.locator('[data-testid="workspace-space-switch-space-worktree-root"]').click()
        await window.locator('[data-testid="workspace-space-menu-space-worktree-root"]').click()
        await expect(window.locator('[data-testid="workspace-space-action-menu"]')).toBeVisible()
        await window.locator('[data-testid="workspace-space-action-create"]').click()

        const worktreeWindow = window.locator('[data-testid="space-worktree-window"]')
        await expect(worktreeWindow).toBeVisible()

        await worktreeWindow.locator('[data-testid="space-worktree-mode-existing"]').click()

        const existingBranch = worktreeWindow.locator(
          '[data-testid="space-worktree-existing-branch"]',
        )
        await expect(existingBranch).toHaveValue(/\S+/)

        await expect(worktreeWindow.locator('.workspace-space-worktree__error')).toHaveCount(0)
      } finally {
        await electronApp.close()
      }
    } finally {
      if (repoPath) {
        await removePathWithRetry(repoPath)
      }
    }
  })
})
