import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { expect, test } from '@playwright/test'
import { launchApp, removePathWithRetry } from './workspace-canvas.helpers'
import { createLocalOnlyProjectViaWizard } from './m6.endpoints-mounts.addProjectWizard.steps'
import { pathExists, pollFor } from './m6.endpoints-mounts.integration.helpers'

const execFileAsync = promisify(execFile)

async function runGit(args: string[], cwd: string): Promise<void> {
  await execFileAsync('git', args, {
    cwd,
    env: process.env,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  })
}

async function createRepo(repoDir: string): Promise<string> {
  await mkdir(repoDir, { recursive: true })
  await runGit(['init'], repoDir)
  await runGit(['config', 'user.email', 'test@example.com'], repoDir)
  await runGit(['config', 'user.name', 'OpenCove Test'], repoDir)
  await runGit(['config', 'core.autocrlf', 'false'], repoDir)
  await runGit(['config', 'core.safecrlf', 'false'], repoDir)
  await writeFile(path.join(repoDir, 'README.md'), '# temp\n', 'utf8')
  await runGit(['add', '.'], repoDir)
  await runGit(['commit', '-m', 'init'], repoDir)
  return repoDir
}

test.describe('M6 - Local mount worktree PR chip integration', () => {
  test.setTimeout(180_000)

  test('shows branch badge + PR chip after creating worktree', async () => {
    const repoBaseDir = await mkdtemp(path.join(tmpdir(), 'opencove-e2e-m6-local-worktree-'))
    const repoSeedDir = path.join(repoBaseDir, 'repo')
    const repoDir = await createRepo(repoSeedDir)
    const repoDirCanonical = await realpath(repoDir).catch(() => repoDir)
    const repoRootCandidates = [
      ...new Set([repoDir, repoDirCanonical].map(value => value.replace(/[\\/]+$/, ''))),
    ]

    const { electronApp, window } = await launchApp({
      env: {
        OPENCOVE_TEST_GITHUB_INTEGRATION: '1',
      },
    })

    try {
      const resetResult = await window.evaluate(async () => {
        return await window.opencoveApi.persistence.writeWorkspaceStateRaw({
          raw: JSON.stringify({
            formatVersion: 1,
            activeWorkspaceId: null,
            workspaces: [],
            settings: {
              defaultProvider: 'codex',
              customModelEnabledByProvider: {
                'claude-code': false,
                codex: true,
              },
              customModelByProvider: {
                'claude-code': '',
                codex: 'gpt-5.2-codex',
              },
              customModelOptionsByProvider: {
                'claude-code': [],
                codex: ['gpt-5.2-codex'],
              },
            },
          }),
        })
      })
      if (!resetResult.ok) {
        throw new Error(
          `Failed to reset workspace state: ${resetResult.reason}: ${resetResult.error.code}${
            resetResult.error.debugMessage ? `: ${resetResult.error.debugMessage}` : ''
          }`,
        )
      }

      await window.reload({ waitUntil: 'domcontentloaded' })

      const localProjectName = `Local Repo (Worktree PR) ${randomUUID()}`
      await createLocalOnlyProjectViaWizard({
        window,
        projectName: localProjectName,
        localRootPath: repoDir,
      })

      const projectItem = window
        .locator('.workspace-sidebar [data-testid^="workspace-item-"]')
        .filter({ hasText: localProjectName })
        .first()
      await expect(projectItem).toBeVisible()
      await projectItem.click({ noWaitAfter: true })

      const workspaceId = await pollFor(
        async () =>
          await window.evaluate(async projectName => {
            const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
            if (!raw) {
              return null
            }

            try {
              const parsed = JSON.parse(raw) as {
                workspaces?: Array<{ id?: string; name?: string }>
              }
              const workspace =
                parsed.workspaces?.find(candidate => candidate?.name === projectName) ?? null
              return typeof workspace?.id === 'string' ? workspace.id : null
            } catch {
              return null
            }
          }, localProjectName),
        { label: 'local project id' },
      )

      const pane = window.locator('.workspace-canvas .react-flow__pane')
      await expect(pane).toBeVisible()
      await pane.click({ button: 'right', position: { x: 320, y: 220 } })
      await window.locator('[data-testid="workspace-context-new-note"]').click()
      await expect(window.locator('.note-node')).toHaveCount(1)

      const note = window.locator('.note-node').first()
      const noteHeader = note.locator('.note-node__header')
      await expect(noteHeader).toBeVisible()
      await noteHeader.click({ position: { x: 40, y: 20 } })
      await expect(window.locator('.react-flow__node.selected')).toHaveCount(1)
      await note.click({ button: 'right', position: { x: 60, y: 16 } })
      await window.locator('[data-testid="workspace-selection-create-space"]').click()

      const spaceMeta = await pollFor(
        async () =>
          await window.evaluate(
            async ({ projectId, repoRoots }) => {
              const normalize = (value: string): string => value.trim().replace(/[\\/]+$/, '')
              const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
              if (!raw) {
                return null
              }

              try {
                const normalizedRepoRoots = Array.isArray(repoRoots)
                  ? repoRoots
                      .filter((candidate): candidate is string => typeof candidate === 'string')
                      .map(normalize)
                  : []
                const parsed = JSON.parse(raw) as {
                  workspaces?: Array<{
                    id?: string
                    spaces?: Array<{
                      id?: string
                      directoryPath?: string
                      targetMountId?: string | null
                    }>
                  }>
                }
                const workspace =
                  parsed.workspaces?.find(candidate => candidate?.id === projectId) ?? null
                const spaces = workspace?.spaces
                if (!Array.isArray(spaces) || spaces.length === 0) {
                  return null
                }

                const last = spaces[spaces.length - 1]
                if (!last || typeof last.id !== 'string') {
                  return null
                }

                const targetMountId =
                  typeof last.targetMountId === 'string' ? last.targetMountId : null
                const directoryPath =
                  typeof last.directoryPath === 'string' ? last.directoryPath : ''

                if (
                  !targetMountId ||
                  normalizedRepoRoots.length === 0 ||
                  !normalizedRepoRoots.includes(normalize(directoryPath))
                ) {
                  return null
                }

                return { spaceId: last.id, targetMountId, directoryPath }
              } catch {
                return null
              }
            },
            { projectId: workspaceId, repoRoots: repoRootCandidates },
          ),
        { label: 'created space metadata' },
      )

      await window.locator(`[data-testid="workspace-space-switch-${spaceMeta.spaceId}"]`).click()
      await window.locator(`[data-testid="workspace-space-menu-${spaceMeta.spaceId}"]`).click()
      await expect(window.locator('[data-testid="workspace-space-action-menu"]')).toBeVisible()
      await window.locator('[data-testid="workspace-space-action-create"]').click()

      const worktreeWindow = window.locator('[data-testid="space-worktree-window"]')
      await expect(worktreeWindow).toBeVisible()
      await expect(worktreeWindow.locator('.workspace-space-worktree__error')).toHaveCount(0)

      const branchName = `space/e2e-local-pr-${Date.now()}`
      await worktreeWindow.locator('[data-testid="space-worktree-branch-name"]').fill(branchName)
      await worktreeWindow.locator('[data-testid="space-worktree-create"]').click()
      await expect(window.locator('[data-testid="space-worktree-window"]')).toHaveCount(0)

      const worktreePath = await pollFor(
        async () =>
          await window.evaluate(
            async ({ projectId, spaceId, repoRoots }) => {
              const normalize = (value: string): string => value.trim().replace(/[\\/]+$/, '')
              const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
              if (!raw) {
                return null
              }

              try {
                const normalizedRepoRoots = Array.isArray(repoRoots)
                  ? repoRoots
                      .filter((candidate): candidate is string => typeof candidate === 'string')
                      .map(normalize)
                  : []
                const parsed = JSON.parse(raw) as {
                  workspaces?: Array<{
                    id?: string
                    spaces?: Array<{ id?: string; directoryPath?: string }>
                  }>
                }
                const workspace =
                  parsed.workspaces?.find(candidate => candidate?.id === projectId) ?? null
                const space =
                  workspace?.spaces?.find(candidate => candidate?.id === spaceId) ?? null
                const directoryPath =
                  typeof space?.directoryPath === 'string' ? space.directoryPath : ''

                if (
                  !directoryPath ||
                  normalizedRepoRoots.length === 0 ||
                  normalizedRepoRoots.includes(normalize(directoryPath))
                ) {
                  return null
                }

                if (!/[\\/][.]opencove[\\/]worktrees[\\/]/.test(directoryPath)) {
                  return null
                }

                return directoryPath
              } catch {
                return null
              }
            },
            { projectId: workspaceId, spaceId: spaceMeta.spaceId, repoRoots: repoRootCandidates },
          ),
        { label: 'space worktree directory' },
      )

      await expect
        .poll(async () => await pathExists(worktreePath), { timeout: 15_000 })
        .toBeTruthy()
      await expect
        .poll(async () => await pathExists(path.join(worktreePath, '.git')), { timeout: 15_000 })
        .toBeTruthy()

      const branchBadge = window.locator(
        `[data-testid="workspace-space-worktree-branch-${spaceMeta.spaceId}"]`,
      )
      await expect(branchBadge).toBeVisible({ timeout: 15_000 })
      await expect(branchBadge).toContainText(branchName)

      const prChip = window.locator(`[data-testid="workspace-space-pr-chip-${spaceMeta.spaceId}"]`)
      await expect(prChip).toBeVisible({ timeout: 15_000 })
      await expect(prChip).toHaveAttribute('href', 'https://example.com/pull/123')
      await expect(prChip).toHaveAttribute('target', '_blank')
      await expect(prChip).toHaveAttribute('title', `Test PR for ${branchName} (#123)`)
    } finally {
      await electronApp.close().catch(() => undefined)
      await removePathWithRetry(repoBaseDir)
    }
  })
})
