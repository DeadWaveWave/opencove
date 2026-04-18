import { expect, test } from '@playwright/test'
import { execFile } from 'node:child_process'
import { realpath, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import {
  buildAppState,
  createWorkspaceDir,
  invokeValue,
  openAuthedCanvas,
  readSharedState,
  writeAppState,
} from './helpers'

const execFileAsync = promisify(execFile)

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/')
}

async function runGit(args: string[], cwd: string): Promise<void> {
  await execFileAsync('git', args, {
    cwd,
    env: process.env,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  })
}

async function initRepo(repoPath: string): Promise<void> {
  await runGit(['init'], repoPath)
  await runGit(['config', 'user.email', 'test@example.com'], repoPath)
  await runGit(['config', 'user.name', 'OpenCove Web E2E'], repoPath)
  await runGit(['config', 'core.autocrlf', 'false'], repoPath)
  await runGit(['config', 'core.safecrlf', 'false'], repoPath)
  await writeFile(path.join(repoPath, 'README.md'), '# web worktree\n', 'utf8')
  await runGit(['add', '.'], repoPath)
  await runGit(['commit', '-m', 'init'], repoPath)
}

test.describe('Worker web canvas - Worktree', () => {
  test('creates a space worktree from the web UI', async ({ page }) => {
    const repoPath = await createWorkspaceDir('web-worktree')
    const canonicalRepoPath = await realpath(repoPath).catch(() => repoPath)
    await initRepo(repoPath)
    await invokeValue<void>(page.request, 'command', 'workspace.approveRoot', { path: repoPath })

    await writeAppState(
      page.request,
      buildAppState({
        workspacePath: repoPath,
        workspaceName: 'web-worktree',
        spaces: [
          {
            id: 'space-1',
            name: 'Main',
            directoryPath: repoPath,
            nodeIds: [],
            rect: { x: 0, y: 0, width: 1200, height: 800 },
          },
        ],
      }),
    )

    await openAuthedCanvas(page)

    await page.locator('[data-testid="workspace-space-menu-space-1"]').click()
    await expect(page.locator('[data-testid="workspace-space-action-menu"]')).toBeVisible()
    await page.locator('[data-testid="workspace-space-action-create"]').click()

    await expect(page.locator('[data-testid="space-worktree-window"]')).toBeVisible()

    const branchName = `feature/web-e2e-${Date.now()}`
    await page.locator('[data-testid="space-worktree-branch-name"]').fill(branchName)
    await expect(page.locator('[data-testid="space-worktree-create"]')).toBeEnabled()
    await page.locator('[data-testid="space-worktree-create"]').click()

    const expectedWorktreesRoot = normalizePath(
      path.join(canonicalRepoPath, '.opencove', 'worktrees'),
    )

    await expect(page.locator('[data-testid="workspace-space-switch-space-1"]')).toContainText(
      branchName,
      {
        timeout: 30_000,
      },
    )

    await expect
      .poll(
        async () => {
          const shared = await readSharedState(page.request)
          const space =
            shared.state?.workspaces[0]?.spaces.find(item => item.id === 'space-1') ?? null
          const directoryPath = space?.directoryPath
          if (typeof directoryPath !== 'string') {
            return false
          }

          const canonicalDirectoryPath = await realpath(directoryPath).catch(() => directoryPath)

          const normalized = normalizePath(canonicalDirectoryPath)
          return (
            normalized !== normalizePath(canonicalRepoPath) &&
            normalized.startsWith(`${expectedWorktreesRoot}/`)
          )
        },
        { timeout: 30_000 },
      )
      .toBe(true)
  })
})
