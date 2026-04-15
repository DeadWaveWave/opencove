import { expect, test } from '@playwright/test'
import { execFile, spawn } from 'node:child_process'
import { access, mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import {
  createTestUserDataDir,
  launchApp,
  removePathWithRetry,
  seedWorkspaceState,
} from './workspace-canvas.helpers'

const execFileAsync = promisify(execFile)
const windowsOnly = process.platform !== 'win32'

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

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath)
    return true
  } catch {
    return false
  }
}

async function killProcessTree(pid: number): Promise<void> {
  try {
    await execFileAsync('taskkill', ['/PID', String(pid), '/T', '/F'], {
      windowsHide: true,
    })
  } catch {
    // The detached process may already be gone during cleanup.
  }
}

async function createTempRepoWithWorktree(): Promise<{
  repoPath: string
  worktreePath: string
  branchName: string
}> {
  const repoDir = await mkdtemp(path.join(tmpdir(), 'OpenCove Worktree Archive E2E '))

  await runGit(['init'], repoDir)
  await runGit(['config', 'user.email', 'test@example.com'], repoDir)
  await runGit(['config', 'user.name', 'OpenCove Test'], repoDir)
  await runGit(['config', 'core.autocrlf', 'false'], repoDir)
  await runGit(['config', 'core.safecrlf', 'false'], repoDir)
  await writeFile(path.join(repoDir, 'README.md'), '# temp\n', 'utf8')
  await runGit(['add', '.'], repoDir)
  await runGit(['commit', '-m', 'init'], repoDir)

  const worktreesRoot = path.join(repoDir, '.opencove', 'worktrees with spaces')
  await mkdir(worktreesRoot, { recursive: true })

  const worktreePath = path.join(worktreesRoot, `space archive warning ${Date.now()}`)
  const branchName = `feature/archive-warning-${Date.now()}`

  await runGit(['worktree', 'add', '-b', branchName, worktreePath, 'HEAD'], repoDir)

  return {
    repoPath: await realpath(repoDir),
    worktreePath: await realpath(worktreePath),
    branchName,
  }
}

test.describe('Workspace Canvas - Worktree Archive (Windows)', () => {
  test.skip(windowsOnly, 'Windows only')

  test('shows a warning when archive cannot remove a locked worktree directory', async () => {
    const userDataDir = await createTestUserDataDir()
    let repoPath = ''
    let worktreePath = ''
    let branchName = ''
    let backgroundPid: number | null = null

    try {
      const tempRepo = await createTempRepoWithWorktree()
      repoPath = tempRepo.repoPath
      worktreePath = tempRepo.worktreePath
      branchName = tempRepo.branchName

      const { electronApp, window } = await launchApp({
        windowMode: 'offscreen',
        userDataDir,
        cleanupUserDataDir: false,
        env: {
          OPENCOVE_TEST_WORKSPACE: repoPath,
        },
      })

      try {
        await seedWorkspaceState(window, {
          activeWorkspaceId: 'workspace-archive-warning',
          workspaces: [
            {
              id: 'workspace-archive-warning',
              name: path.basename(repoPath),
              path: repoPath,
              nodes: [
                {
                  id: 'note-archive-warning',
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
                  id: 'space-archive-warning',
                  name: 'Archive Warning',
                  directoryPath: worktreePath,
                  nodeIds: ['note-archive-warning'],
                  rect: { x: 180, y: 140, width: 620, height: 420 },
                },
              ],
              activeSpaceId: 'space-archive-warning',
            },
          ],
        })

        await expect(window.locator('.note-node').first()).toBeVisible()

        const backgroundChild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1e6)'], {
          cwd: worktreePath,
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
        })
        backgroundPid = backgroundChild.pid ?? null
        backgroundChild.unref()

        expect(backgroundPid ?? 0).toBeGreaterThan(0)
        await window.waitForTimeout(1500)

        await window.locator('[data-testid="workspace-space-switch-space-archive-warning"]').click()
        await window.locator('[data-testid="workspace-space-menu-space-archive-warning"]').click()
        await expect(window.locator('[data-testid="workspace-space-action-menu"]')).toBeVisible()
        await window.locator('[data-testid="workspace-space-action-archive"]').click()

        await expect(window.locator('[data-testid="space-worktree-window"]')).toBeVisible()
        await window.locator('[data-testid="space-worktree-archive-delete-branch"]').click()
        await window.locator('[data-testid="space-worktree-archive-submit"]').click()

        await expect(window.locator('[data-testid="space-worktree-window"]')).toHaveCount(0)
        await expect(window.locator('[data-testid="app-message"]')).toContainText(
          'Space archived, but the worktree directory could not be removed.',
        )

        await expect
          .poll(async () => {
            return await window.evaluate(async () => {
              const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
              if (!raw) {
                return null
              }

              const parsed = JSON.parse(raw) as {
                workspaces?: Array<{
                  nodes?: unknown[]
                  spaces?: unknown[]
                }>
              }

              const workspace = parsed.workspaces?.[0]
              return {
                nodeCount: workspace?.nodes?.length ?? 0,
                spaceCount: workspace?.spaces?.length ?? 0,
              }
            })
          })
          .toEqual({
            nodeCount: 0,
            spaceCount: 0,
          })
      } finally {
        await electronApp.close()
      }

      expect(await pathExists(worktreePath)).toBe(true)

      const worktreesAfter = await runGit(['worktree', 'list', '--porcelain'], repoPath)
      expect(worktreesAfter.stdout).not.toContain(worktreePath)

      const branchAfter = await runGit(['branch', '--list', branchName], repoPath)
      expect(branchAfter.stdout.trim()).toBe('')
    } finally {
      if (backgroundPid !== null) {
        await killProcessTree(backgroundPid)
      }

      if (repoPath) {
        await removePathWithRetry(repoPath)
      }

      await removePathWithRetry(userDataDir)
    }
  })
})
