import { randomUUID } from 'node:crypto'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { launchApp, removePathWithRetry } from './workspace-canvas.helpers'
import { pathExists, pollFor } from './m6.endpoints-mounts.integration.helpers'
import { createRepo, resetWorkspaceState } from './m6.endpoints-mounts.legacy-repair.helpers'

test.describe('M6 - Legacy mount/space repair integration (local)', () => {
  test.setTimeout(180_000)

  test('repairs legacy local workspace mounts + space target mount', async () => {
    const legacyWorkspaceId = `legacy-local-${randomUUID()}`
    const legacyProjectName = 'Legacy Local Project'

    const baseDir = await mkdtemp(path.join(tmpdir(), 'opencove-e2e-m6-legacy-local-'))
    const repoDir = await createRepo(path.join(baseDir, 'repo'))

    const { electronApp, window } = await launchApp({
      env: {
        OPENCOVE_TEST_AGENT_SESSION_SCENARIO: 'codex-standby-only',
      },
    })

    try {
      await resetWorkspaceState(window, {
        formatVersion: 1,
        activeWorkspaceId: legacyWorkspaceId,
        workspaces: [
          {
            id: legacyWorkspaceId,
            name: legacyProjectName,
            path: repoDir,
            nodes: [],
            worktreesRoot: '',
            viewport: { x: 0, y: 0, zoom: 1 },
            isMinimapVisible: true,
            spaces: [],
            activeSpaceId: null,
            spaceArchiveRecords: [],
          },
        ],
        settings: {
          standardWindowSizeBucket: 'regular',
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
      })

      await window.reload({ waitUntil: 'domcontentloaded' })

      const createdMountId = await pollFor(
        async () =>
          await window.evaluate(async workspaceId => {
            const result = await window.opencoveApi.controlSurface.invoke<{
              mounts: Array<{ mountId: string }>
            }>({
              kind: 'query',
              id: 'mount.list',
              payload: { projectId: workspaceId },
            })
            return typeof result.mounts?.[0]?.mountId === 'string' ? result.mounts[0].mountId : null
          }, legacyWorkspaceId),
        { label: 'legacy local mount created', timeoutMs: 30_000 },
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
      await note.click({ button: 'right', position: { x: 60, y: 16 } })
      await window.locator('[data-testid="workspace-selection-create-space"]').click()

      const spaceId = await pollFor(
        async () =>
          await window.evaluate(async workspaceId => {
            const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
            if (!raw) {
              return null
            }

            try {
              const parsed = JSON.parse(raw) as {
                workspaces?: Array<{ id?: string; spaces?: Array<{ id?: string }> }>
              }
              const workspace =
                parsed.workspaces?.find(candidate => candidate?.id === workspaceId) ?? null
              const spaces = workspace?.spaces
              const last = Array.isArray(spaces) ? spaces[spaces.length - 1] : null
              return typeof last?.id === 'string' ? last.id : null
            } catch {
              return null
            }
          }, legacyWorkspaceId),
        { label: 'legacy local space id', timeoutMs: 30_000 },
      )

      await window
        .evaluate(
          async ({ workspaceId, spaceId: spaceIdInput }) => {
            const mountResult = await window.opencoveApi.controlSurface.invoke<{
              mounts: Array<{ mountId: string }>
            }>({
              kind: 'query',
              id: 'mount.list',
              payload: { projectId: workspaceId },
            })

            await Promise.all(
              mountResult.mounts.map(mount =>
                window.opencoveApi.controlSurface
                  .invoke({
                    kind: 'command',
                    id: 'mount.remove',
                    payload: { mountId: mount.mountId },
                  })
                  .catch(() => undefined),
              ),
            )

            const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
            if (!raw) {
              throw new Error('Missing persisted workspace state.')
            }

            const parsed = JSON.parse(raw) as {
              workspaces?: Array<{
                id?: string
                spaces?: Array<{ id?: string; targetMountId?: string | null }>
              }>
            }

            const workspaces = Array.isArray(parsed.workspaces) ? parsed.workspaces : []
            parsed.workspaces = workspaces.map(workspace => {
              if (workspace?.id !== workspaceId || !Array.isArray(workspace.spaces)) {
                return workspace
              }

              return {
                ...workspace,
                spaces: workspace.spaces.map(space =>
                  space?.id === spaceIdInput ? { ...space, targetMountId: null } : space,
                ),
              }
            })

            return await window.opencoveApi.persistence.writeWorkspaceStateRaw({
              raw: JSON.stringify(parsed),
            })
          },
          { workspaceId: legacyWorkspaceId, spaceId },
        )
        .then(result => {
          if (!result.ok) {
            throw new Error(
              `Failed to write legacy-mutation workspace state: ${result.reason}: ${result.error.code}${
                result.error.debugMessage ? `: ${result.error.debugMessage}` : ''
              }`,
            )
          }
        })

      await window.reload({ waitUntil: 'domcontentloaded' })

      const repairedMountId = await pollFor(
        async () =>
          await window.evaluate(async workspaceId => {
            const result = await window.opencoveApi.controlSurface.invoke<{
              mounts: Array<{ mountId: string }>
            }>({
              kind: 'query',
              id: 'mount.list',
              payload: { projectId: workspaceId },
            })
            return typeof result.mounts?.[0]?.mountId === 'string' ? result.mounts[0].mountId : null
          }, legacyWorkspaceId),
        { label: 'legacy local mount re-created', timeoutMs: 30_000 },
      )

      await pollFor(
        async () =>
          await window.evaluate(
            async ({ workspaceId, spaceId: spaceIdInput, mountId }) => {
              const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
              if (!raw) {
                return null
              }

              try {
                const parsed = JSON.parse(raw) as {
                  workspaces?: Array<{
                    id?: string
                    spaces?: Array<{ id?: string; targetMountId?: string | null }>
                  }>
                }
                const workspace =
                  parsed.workspaces?.find(candidate => candidate?.id === workspaceId) ?? null
                const space =
                  workspace?.spaces?.find(candidate => candidate?.id === spaceIdInput) ?? null
                return space?.targetMountId === mountId ? true : null
              } catch {
                return null
              }
            },
            { workspaceId: legacyWorkspaceId, spaceId, mountId: repairedMountId },
          ),
        { label: 'legacy local space target mount repaired', timeoutMs: 30_000 },
      )

      await expect(repairedMountId).not.toBe(createdMountId)

      await window.locator(`[data-testid="workspace-space-switch-${spaceId}"]`).click()
      await window.locator(`[data-testid="workspace-space-menu-${spaceId}"]`).click()
      await expect(window.locator('[data-testid="workspace-space-action-menu"]')).toBeVisible()
      await window.locator('[data-testid="workspace-space-action-create"]').click()

      const worktreeWindow = window.locator('[data-testid="space-worktree-window"]')
      await expect(worktreeWindow).toBeVisible()

      const branchName = `space/legacy-local-${Date.now()}`
      await worktreeWindow.locator('[data-testid="space-worktree-branch-name"]').fill(branchName)
      await worktreeWindow.locator('[data-testid="space-worktree-create"]').click()
      await expect(window.locator('[data-testid="space-worktree-window"]')).toHaveCount(0)

      const worktreePath = await pollFor(
        async () =>
          await window.evaluate(
            async ({ workspaceId, spaceId: spaceIdInput, repoRoot }) => {
              const normalize = (value: string): string => value.trim().replace(/[\\/]+$/, '')
              const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
              if (!raw) {
                return null
              }

              try {
                const parsed = JSON.parse(raw) as {
                  workspaces?: Array<{
                    id?: string
                    spaces?: Array<{ id?: string; directoryPath?: string }>
                  }>
                }
                const workspace =
                  parsed.workspaces?.find(candidate => candidate?.id === workspaceId) ?? null
                const space =
                  workspace?.spaces?.find(candidate => candidate?.id === spaceIdInput) ?? null
                const directoryPath =
                  typeof space?.directoryPath === 'string' ? space.directoryPath : ''

                if (!directoryPath) {
                  return null
                }

                if (normalize(directoryPath) === normalize(repoRoot)) {
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
            { workspaceId: legacyWorkspaceId, spaceId, repoRoot: repoDir },
          ),
        { label: 'legacy local worktree directory', timeoutMs: 30_000 },
      )

      await expect
        .poll(async () => await pathExists(worktreePath), { timeout: 15_000 })
        .toBeTruthy()
      await expect
        .poll(async () => await pathExists(path.join(worktreePath, '.git')), { timeout: 15_000 })
        .toBeTruthy()
    } finally {
      await electronApp.close().catch(() => undefined)
      await removePathWithRetry(baseDir)
    }
  })
})
