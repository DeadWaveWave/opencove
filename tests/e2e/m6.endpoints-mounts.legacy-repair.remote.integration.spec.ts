import { randomUUID } from 'node:crypto'
import { mkdtemp, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { launchApp, removePathWithRetry } from './workspace-canvas.helpers'
import { createRemoteOnlyProjectViaWizard } from './m6.endpoints-mounts.addProjectWizard.steps'
import {
  closeSettings,
  openSettings,
  pathExists,
  pollFor,
  reserveLoopbackPort,
  startRemoteWorker,
  stopRemoteWorker,
  switchSettingsPage,
} from './m6.endpoints-mounts.integration.helpers'
import { createRepo } from './m6.endpoints-mounts.legacy-repair.helpers'

test.describe('M6 - Legacy mount/space repair integration (remote)', () => {
  test.setTimeout(180_000)

  test('repairs remote workspace space mount binding', async () => {
    const remoteToken = `m6-legacy-remote-${randomUUID()}`
    const remotePort = await reserveLoopbackPort()
    const remoteHost = '127.0.0.1'

    const remoteBaseDir = await mkdtemp(path.join(tmpdir(), 'opencove-e2e-m6-legacy-remote-'))
    const remoteRepoDir = await createRepo(path.join(remoteBaseDir, 'repo'))
    const remoteRepoDirCanonical = await realpath(remoteRepoDir).catch(() => remoteRepoDir)

    const remoteWorkerUserDataDir = await mkdtemp(
      path.join(tmpdir(), 'opencove-e2e-m6-legacy-remote-worker-'),
    )

    const remoteWorker = await startRemoteWorker({
      hostname: remoteHost,
      port: remotePort,
      token: remoteToken,
      userDataDir: remoteWorkerUserDataDir,
      homeDir: remoteBaseDir,
      approveRoot: remoteBaseDir,
      agentSessionScenario: 'codex-standby-only',
    })

    const { electronApp, window } = await launchApp({
      env: {
        OPENCOVE_TEST_AGENT_SESSION_SCENARIO: 'codex-standby-only',
      },
    })

    const endpointDisplayName = 'Legacy Remote Worker'
    const projectName = `Legacy Remote Project (${Date.now()})`

    try {
      const resetResult = await window.evaluate(async () => {
        return await window.opencoveApi.persistence.writeWorkspaceStateRaw({
          raw: JSON.stringify({
            formatVersion: 1,
            activeWorkspaceId: null,
            workspaces: [],
            settings: {
              experimentalRemoteWorkersEnabled: true,
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

      await openSettings(window)
      await switchSettingsPage(window, 'endpoints')
      await window.locator('[data-testid="settings-endpoints-open-register"]').click()

      await window
        .locator('[data-testid="settings-endpoints-register-displayName"]')
        .fill(endpointDisplayName)
      await window.locator('[data-testid="settings-endpoints-register-hostname"]').fill(remoteHost)
      await window
        .locator('[data-testid="settings-endpoints-register-port"]')
        .fill(String(remotePort))
      await window.locator('[data-testid="settings-endpoints-register-token"]').fill(remoteToken)
      await window.locator('[data-testid="settings-endpoints-register-submit"]').click()

      const remoteEndpointId = await pollFor(
        async () =>
          await window.evaluate(async displayName => {
            const result = await window.opencoveApi.controlSurface.invoke<{
              endpoints: Array<{ endpointId: string; displayName: string }>
            }>({
              kind: 'query',
              id: 'endpoint.list',
              payload: null,
            })
            const endpoint = result.endpoints.find(
              candidate =>
                candidate.displayName === displayName && candidate.endpointId !== 'local',
            )
            return endpoint?.endpointId ?? null
          }, endpointDisplayName),
        { label: 'remote endpoint id' },
      )

      await closeSettings(window)

      await createRemoteOnlyProjectViaWizard({
        window,
        projectName,
        remoteEndpointId,
        remoteRootPath: remoteRepoDir,
      })

      const projectItem = window
        .locator('.workspace-sidebar [data-testid^="workspace-item-"]')
        .filter({ hasText: projectName })
        .first()
      await expect(projectItem).toBeVisible()
      await projectItem.click({ noWaitAfter: true })

      const workspaceMeta = await pollFor(
        async () =>
          await window.evaluate(async name => {
            const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
            if (!raw) {
              return null
            }

            try {
              const parsed = JSON.parse(raw) as {
                workspaces?: Array<{ id?: string; name?: string; path?: string }>
              }
              const workspace =
                parsed.workspaces?.find(candidate => candidate?.name === name) ?? null
              if (
                !workspace ||
                typeof workspace.id !== 'string' ||
                typeof workspace.path !== 'string'
              ) {
                return null
              }
              return { id: workspace.id, path: workspace.path }
            } catch {
              return null
            }
          }, projectName),
        { label: 'remote workspace id/path' },
      )

      const mountMeta = await pollFor(
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
          }, workspaceMeta.id),
        { label: 'remote project mount id' },
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
          }, workspaceMeta.id),
        { label: 'remote space id', timeoutMs: 30_000 },
      )

      await window
        .evaluate(
          async ({ workspaceId, spaceId: spaceIdInput, placeholderPath }) => {
            const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
            if (!raw) {
              throw new Error('Missing persisted workspace state.')
            }

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

            const workspaces = Array.isArray(parsed.workspaces) ? parsed.workspaces : []
            parsed.workspaces = workspaces.map(workspace => {
              if (workspace?.id !== workspaceId || !Array.isArray(workspace.spaces)) {
                return workspace
              }

              return {
                ...workspace,
                spaces: workspace.spaces.map(space =>
                  space?.id === spaceIdInput
                    ? { ...space, targetMountId: null, directoryPath: placeholderPath }
                    : space,
                ),
              }
            })

            return await window.opencoveApi.persistence.writeWorkspaceStateRaw({
              raw: JSON.stringify(parsed),
            })
          },
          { workspaceId: workspaceMeta.id, spaceId, placeholderPath: workspaceMeta.path },
        )
        .then(result => {
          if (!result.ok) {
            throw new Error(
              `Failed to write remote legacy-mutation workspace state: ${result.reason}: ${result.error.code}${
                result.error.debugMessage ? `: ${result.error.debugMessage}` : ''
              }`,
            )
          }
        })

      await window.reload({ waitUntil: 'domcontentloaded' })

      await pollFor(
        async () =>
          await window.evaluate(
            async ({ workspaceId, spaceId: spaceIdInput, mountId, placeholderPath }) => {
              const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
              if (!raw) {
                return null
              }

              try {
                const parsed = JSON.parse(raw) as {
                  workspaces?: Array<{
                    id?: string
                    spaces?: Array<{
                      id?: string
                      targetMountId?: string | null
                      directoryPath?: string
                    }>
                  }>
                }
                const workspace =
                  parsed.workspaces?.find(candidate => candidate?.id === workspaceId) ?? null
                const space =
                  workspace?.spaces?.find(candidate => candidate?.id === spaceIdInput) ?? null
                if (!space) {
                  return null
                }

                const targetMountOk = space.targetMountId === mountId
                const directoryPathOk =
                  typeof space.directoryPath === 'string' &&
                  space.directoryPath.trim().length > 0 &&
                  space.directoryPath !== placeholderPath
                return targetMountOk && directoryPathOk ? true : null
              } catch {
                return null
              }
            },
            {
              workspaceId: workspaceMeta.id,
              spaceId,
              mountId: mountMeta,
              placeholderPath: workspaceMeta.path,
            },
          ),
        { label: 'remote space mount binding repaired', timeoutMs: 30_000 },
      )

      await window.locator(`[data-testid="workspace-space-switch-${spaceId}"]`).click()
      await window.locator(`[data-testid="workspace-space-menu-${spaceId}"]`).click()
      await expect(window.locator('[data-testid="workspace-space-action-menu"]')).toBeVisible()
      await window.locator('[data-testid="workspace-space-action-create"]').click()

      const worktreeWindow = window.locator('[data-testid="space-worktree-window"]')
      await expect(worktreeWindow).toBeVisible()

      const branchName = `space/legacy-remote-${Date.now()}`
      await worktreeWindow.locator('[data-testid="space-worktree-branch-name"]').fill(branchName)
      await worktreeWindow.locator('[data-testid="space-worktree-create"]').click()
      await expect(window.locator('[data-testid="space-worktree-window"]')).toHaveCount(0)

      const worktreePath = await pollFor(
        async () =>
          await window.evaluate(
            async ({ workspaceId, spaceId: spaceIdInput, repoRoots }) => {
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
                  parsed.workspaces?.find(candidate => candidate?.id === workspaceId) ?? null
                const space =
                  workspace?.spaces?.find(candidate => candidate?.id === spaceIdInput) ?? null
                const directoryPath =
                  typeof space?.directoryPath === 'string' ? space.directoryPath : ''

                if (!directoryPath || normalizedRepoRoots.length === 0) {
                  return null
                }

                if (normalizedRepoRoots.includes(normalize(directoryPath))) {
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
            {
              workspaceId: workspaceMeta.id,
              spaceId,
              repoRoots: [remoteRepoDir, remoteRepoDirCanonical],
            },
          ),
        { label: 'remote worktree directory', timeoutMs: 30_000 },
      )

      await expect
        .poll(async () => await pathExists(worktreePath), { timeout: 15_000 })
        .toBeTruthy()
      await expect
        .poll(async () => await pathExists(path.join(worktreePath, '.git')), { timeout: 15_000 })
        .toBeTruthy()
    } catch (error) {
      process.stderr.write(`[e2e] Remote worker logs:\n${remoteWorker.logs()}\n`)
      throw error
    } finally {
      await electronApp.close().catch(() => undefined)
      await stopRemoteWorker(remoteWorker.child).catch(() => undefined)
      await removePathWithRetry(remoteWorkerUserDataDir)
      await removePathWithRetry(remoteBaseDir)
    }
  })
})
