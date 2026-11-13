import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { launchApp, seedWorkspaceState } from './workspace-canvas.helpers'

const MATERIAL_WORKSPACE = 'pixel-material-workspace'

async function createBranchFixture(branch: string, worktreeName: string) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'opencove-space-branch-')))
  const repo = path.join(root, 'repo')
  const worktree = path.join(repo, '.opencove', 'worktrees', worktreeName)
  await mkdir(repo, { recursive: true })
  await writeFile(path.join(repo, 'README.md'), '# branch\n')
  await writeFile(path.join(repo, '.gitignore'), '.opencove/\n')
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo })
  git('init', '-b', 'main')
  git('config', 'user.name', 'OpenCove E2E')
  git('config', 'user.email', 'e2e@example.com')
  git('add', '.')
  git('commit', '--no-gpg-sign', '-m', 'init')
  git('worktree', 'add', '-b', branch, worktree)
  return { root, repo, worktree }
}

test.describe('Sidebar - Space branch', () => {
  test("names a Space's worktree branch on its card, from the same listing as the canvas", async ({
    browserName,
  }) => {
    void browserName
    const { root, repo, worktree } = await createBranchFixture('pixel/review', 'review')
    const { electronApp, window } = await launchApp()
    try {
      await seedWorkspaceState(window, {
        activeWorkspaceId: MATERIAL_WORKSPACE,
        workspaces: [
          {
            id: MATERIAL_WORKSPACE,
            name: 'Glacier workspace',
            path: repo,
            nodes: [],
            spaces: [
              {
                id: 'pixel-build-space',
                name: 'Build workspace',
                directoryPath: repo,
                labelColor: 'blue',
                pinned: false,
                nodeIds: [],
                rect: { x: 24, y: 42, width: 932, height: 970 },
              },
              {
                id: 'pixel-review-space',
                name: 'Review worktree',
                directoryPath: worktree,
                labelColor: 'green',
                pinned: false,
                nodeIds: [],
                rect: { x: 976, y: 42, width: 470, height: 970 },
              },
            ],
            activeSpaceId: 'pixel-build-space',
          },
        ],
      })
      // Retain the material fixture's canvas branch boundary check as well as the card.
      await expect(
        window.getByTestId('workspace-space-worktree-branch-pixel-review-space'),
      ).toContainText('pixel/review', { timeout: 20_000 })
      const review = window.getByTestId(
        `workspace-space-item-${MATERIAL_WORKSPACE}-pixel-review-space`,
      )
      // The canvas frame and the sidebar card name the same branch.
      await expect(review.locator('.workspace-space-item__meta-branch')).toHaveText('pixel/review')
      await expect(review).toContainText('pixel/review')
      // The build Space works in the project's own checkout: its card names no branch.
      const build = window.getByTestId(
        `workspace-space-item-${MATERIAL_WORKSPACE}-pixel-build-space`,
      )
      await expect(build).toBeVisible()
      await expect(build.locator('.workspace-space-item__meta-branch')).toHaveCount(0)

      // The project header names the branch the project's own checkout is on.
      const current = execFileSync('git', ['-C', repo, 'branch', '--show-current'], {
        encoding: 'utf8',
      }).trim()
      await expect(window.getByTestId(`workspace-project-branch-${MATERIAL_WORKSPACE}`)).toHaveText(
        current,
      )
    } finally {
      await electronApp.close()
      await rm(root, { recursive: true, force: true })
    }
  })

  test('a long Space name and branch stay inside the card and end in an ellipsis', async () => {
    const branch = 'feat/supporting-renamed-agent-sessions-after-the-review'
    const { root, repo, worktree } = await createBranchFixture(branch, 'renamed')

    const { electronApp, window } = await launchApp()
    try {
      await seedWorkspaceState(window, {
        activeWorkspaceId: 'branch-project',
        workspaces: [
          {
            id: 'branch-project',
            name: 'branch',
            path: repo,
            nodes: [],
            spaces: [
              {
                id: 'long-space',
                name: branch,
                directoryPath: worktree,
                labelColor: 'orange',
                nodeIds: [],
                rect: { x: 0, y: 0, width: 600, height: 400 },
              },
            ],
            activeSpaceId: 'long-space',
          },
        ],
      })
      const card = window.getByTestId('workspace-space-item-branch-project-long-space')
      const branchLine = card.locator('.workspace-space-item__meta-branch')
      await expect(branchLine).toHaveText(branch, { timeout: 20_000 })
      const fit = await card.evaluate(select => {
        const item = select.closest('.workspace-space-item')!.getBoundingClientRect()
        const sidebar = select.closest('.workspace-sidebar')!.getBoundingClientRect()
        const inItem = (selector: string) => {
          const text = select.querySelector<HTMLElement>(selector)!
          return {
            inside: text.getBoundingClientRect().right <= item.right + 0.5,
            clipped: text.scrollWidth > text.clientWidth,
            overflow: getComputedStyle(text).textOverflow,
          }
        }
        return {
          itemInSidebar: item.right <= sidebar.right + 0.5,
          name: inItem('.workspace-space-item__name'),
          branch: inItem('.workspace-space-item__meta-branch'),
        }
      })
      const ellipsis = { inside: true, clipped: true, overflow: 'ellipsis' }
      expect(fit).toEqual({ itemInSidebar: true, name: ellipsis, branch: ellipsis })
    } finally {
      await electronApp.close()
      await rm(root, { recursive: true, force: true })
    }
  })
})
