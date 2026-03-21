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
  const repoDir = await mkdtemp(path.join(tmpdir(), 'OpenCove Worktree Create Light E2E '))

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

function parseCssRgb(value: string): { r: number; g: number; b: number } | null {
  const match = value.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([0-9.]+)\s*)?\)/)
  if (!match) {
    return null
  }

  return {
    r: Number.parseInt(match[1], 10),
    g: Number.parseInt(match[2], 10),
    b: Number.parseInt(match[3], 10),
  }
}

test.describe('Workspace Canvas - Worktree Create (Light Theme)', () => {
  test('uses readable (non-white) heading text in light theme', async () => {
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
          activeWorkspaceId: 'workspace-worktree-create-light',
          workspaces: [
            {
              id: 'workspace-worktree-create-light',
              name: path.basename(repoPath),
              path: repoPath,
              nodes: [
                {
                  id: 'note-worktree-create-light',
                  title: 'Worktree Create Light',
                  position: { x: 220, y: 180 },
                  width: 320,
                  height: 220,
                  kind: 'note',
                  task: {
                    text: 'seed',
                  },
                },
              ],
              spaces: [
                {
                  id: 'space-worktree-root',
                  name: 'Root Space',
                  directoryPath: repoPath,
                  nodeIds: ['note-worktree-create-light'],
                  rect: { x: 180, y: 140, width: 620, height: 420 },
                },
              ],
              activeSpaceId: 'space-worktree-root',
            },
          ],
          settings: {
            uiTheme: 'light',
          },
        })

        await expect(window.locator('html')).toHaveAttribute('data-cove-theme', 'light')
        await expect(window.locator('.note-node').first()).toBeVisible()

        await window.locator('[data-testid="workspace-space-switch-space-worktree-root"]').click()
        await window.locator('[data-testid="workspace-space-menu-space-worktree-root"]').click()
        await expect(window.locator('[data-testid="workspace-space-action-menu"]')).toBeVisible()
        await window.locator('[data-testid="workspace-space-action-create"]').click()

        const worktreeWindow = window.locator('[data-testid="space-worktree-window"]')
        await expect(worktreeWindow).toBeVisible()

        const heading = worktreeWindow
          .locator('[data-testid="space-worktree-create-view"] h4')
          .first()
        await expect(heading).toBeVisible()

        const headingColor = await heading.evaluate(element => {
          return window.getComputedStyle(element).color
        })

        const rgb = parseCssRgb(headingColor)
        if (!rgb) {
          throw new Error(`Unable to parse heading color: ${headingColor}`)
        }

        // Light theme should use dark-ish text, not white.
        expect(rgb.r).toBeLessThan(200)
        expect(rgb.g).toBeLessThan(200)
        expect(rgb.b).toBeLessThan(200)
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
