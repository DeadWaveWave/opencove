import { expect, test } from '@playwright/test'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { launchApp, removePathWithRetry, seedWorkspaceState } from './workspace-canvas.helpers'

const execFileAsync = promisify(execFile)

async function runGit(args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  const result = await execFileAsync('git', args, {
    cwd,
    env: process.env,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  })

  return {
    stdout: result.stdout?.toString() ?? '',
    stderr: result.stderr?.toString() ?? '',
  }
}

async function createTempRepoWithDirtyWorktree(): Promise<{
  repoPath: string
  worktreePath: string
}> {
  const repoDir = await mkdtemp(path.join(tmpdir(), 'OpenCove Worktree Archive Dirty E2E '))

  await runGit(['init'], repoDir)
  await runGit(['config', 'user.email', 'test@example.com'], repoDir)
  await runGit(['config', 'user.name', 'OpenCove Test'], repoDir)
  await runGit(['config', 'core.autocrlf', 'false'], repoDir)
  await runGit(['config', 'core.safecrlf', 'false'], repoDir)
  await writeFile(path.join(repoDir, 'README.md'), '# temp\n', 'utf8')
  await runGit(['add', '.'], repoDir)
  await runGit(['commit', '-m', 'init'], repoDir)

  const worktreesRoot = path.join(repoDir, '.opencove', 'worktrees')
  await mkdir(worktreesRoot, { recursive: true })

  const worktreePath = path.join(worktreesRoot, `dirty-space-${Date.now()}`)
  const branchName = `feature/dirty-archive-${Date.now()}`
  await runGit(['worktree', 'add', '-b', branchName, worktreePath, 'HEAD'], repoDir)

  await writeFile(path.join(worktreePath, 'UNCOMMITTED.txt'), String(Date.now()), 'utf8')

  return {
    repoPath: await realpath(repoDir),
    worktreePath: await realpath(worktreePath),
  }
}

test.describe('Workspace Canvas - Worktree Archive (Uncommitted changes)', () => {
  test('requires force confirmation before archiving a dirty worktree', async () => {
    let repoPath = ''
    let worktreePath = ''

    try {
      const tempRepo = await createTempRepoWithDirtyWorktree()
      repoPath = tempRepo.repoPath
      worktreePath = tempRepo.worktreePath

      const { electronApp, window } = await launchApp({
        windowMode: 'offscreen',
        env: {
          OPENCOVE_TEST_WORKSPACE: repoPath,
        },
      })

      try {
        await seedWorkspaceState(window, {
          activeWorkspaceId: 'workspace-archive-dirty',
          workspaces: [
            {
              id: 'workspace-archive-dirty',
              name: path.basename(repoPath),
              path: repoPath,
              nodes: [
                {
                  id: 'note-archive-dirty',
                  title: 'Archive Note',
                  position: { x: 220, y: 180 },
                  width: 320,
                  height: 220,
                  kind: 'note',
                  task: {
                    text: 'archive me',
                  },
                },
              ],
              spaces: [
                {
                  id: 'space-archive-dirty',
                  name: 'Archive Dirty',
                  directoryPath: worktreePath,
                  nodeIds: ['note-archive-dirty'],
                  rect: { x: 180, y: 140, width: 620, height: 420 },
                },
              ],
              activeSpaceId: 'space-archive-dirty',
            },
          ],
        })

        await expect(window.locator('.note-node').first()).toBeVisible()

        await window.locator('[data-testid="workspace-space-switch-space-archive-dirty"]').click()
        await window.locator('[data-testid="workspace-space-menu-space-archive-dirty"]').click()
        await expect(window.locator('[data-testid="workspace-space-action-menu"]')).toBeVisible()
        await window.locator('[data-testid="workspace-space-action-archive"]').click()

        await expect(window.locator('[data-testid="space-worktree-window"]')).toBeVisible()
        await expect(
          window.locator('[data-testid="space-worktree-archive-uncommitted-warning"]'),
        ).toBeVisible()
        await expect(
          window.locator('[data-testid="space-worktree-archive-force-confirm"]'),
        ).toBeVisible()
        await expect(window.locator('[data-testid="space-worktree-archive-submit"]')).toBeDisabled()

        await window
          .locator('[data-testid="space-worktree-window"]')
          .screenshot({ path: 'test-results/worktree-archive-uncommitted-warning.png' })

        await window.locator('[data-testid="space-worktree-archive-force-confirm"]').click()
        await expect(window.locator('[data-testid="space-worktree-archive-submit"]')).toBeEnabled()
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
