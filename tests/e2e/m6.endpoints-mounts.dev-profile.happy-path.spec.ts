import { createHash, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { expect, test } from '@playwright/test'
import { buildNodeEvalCommand, launchApp, removePathWithRetry } from './workspace-canvas.helpers'
import { createRemoteOnlyProjectViaWizard } from './m6.endpoints-mounts.addProjectWizard.steps'
import {
  closeSettings,
  openSettings,
  pollFor,
  reserveLoopbackPort,
  startRemoteWorker,
  stopRemoteWorker,
  switchSettingsPage,
} from './m6.endpoints-mounts.integration.helpers'

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
  await runGit(['config', 'user.email', 'dev-profile@example.com'], repoDir)
  await runGit(['config', 'user.name', 'OpenCove Dev Profile'], repoDir)
  await runGit(['config', 'core.autocrlf', 'false'], repoDir)
  await runGit(['config', 'core.safecrlf', 'false'], repoDir)
  await writeFile(path.join(repoDir, 'README.md'), '# temp\n', 'utf8')
  await runGit(['add', '.'], repoDir)
  await runGit(['commit', '-m', 'init'], repoDir)
  return repoDir
}

function toShaCandidates(value: string): string[] {
  const normalized = value.trim().replace(/[\\/]+$/, '')
  const candidates = new Set<string>()
  candidates.add(normalized)
  if (normalized.startsWith('/var/')) {
    candidates.add(`/private${normalized}`)
  } else if (normalized.startsWith('/private/var/')) {
    candidates.add(normalized.slice('/private'.length))
  }

  return [...candidates].map(candidate =>
    createHash('sha1').update(candidate).digest('hex').slice(0, 12),
  )
}

test.describe('M6 - Dev profile happy path (manual)', () => {
  test.setTimeout(300_000)

  test('registers endpoint, creates remote project, creates space worktree, runs terminal, and opens files', async () => {
    test.skip(
      process.env['OPENCOVE_E2E_DEV_PROFILE'] !== '1',
      'Set OPENCOVE_E2E_DEV_PROFILE=1 to run this local dev-profile smoke test.',
    )

    const remoteToken = `m6-dev-${randomUUID()}`
    const remotePort = await reserveLoopbackPort()
    const remoteHost = '127.0.0.1'

    const remoteBaseDir = await mkdtemp(path.join(tmpdir(), 'opencove-dev-profile-m6-remote-'))
    const remoteRepoDir = await createRepo(path.join(remoteBaseDir, 'repo'))
    const remoteRepoDirCanonical = await realpath(remoteRepoDir).catch(() => remoteRepoDir)
    const remoteWorkerUserDataDir = await mkdtemp(
      path.join(tmpdir(), 'opencove-dev-profile-m6-remote-worker-'),
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

    const realHomeDir = process.env['HOME'] ?? ''
    if (!realHomeDir) {
      throw new Error('[dev-profile] Missing HOME env var; cannot run dev profile smoke test.')
    }

    const { electronApp, window } = await launchApp({
      env: {
        NODE_ENV: 'development',
        HOME: realHomeDir,
        USERPROFILE: realHomeDir,
        OPENCOVE_TEST_AGENT_SESSION_SCENARIO: 'codex-standby-only',
      },
      cleanupUserDataDir: true,
    })

    const endpointDisplayName = `Dev Profile Remote (${Date.now()})`
    const projectName = `Dev Profile Project (${Date.now()})`

    try {
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

      const endpointRow = window.locator('.settings-panel__row', { hasText: endpointDisplayName })
      await expect(endpointRow).toBeVisible()
      await endpointRow.locator('[data-testid^="settings-endpoints-ping-"]').click()
      await expect(endpointRow.locator('.settings-panel__hint')).toBeVisible()

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

      const workspaceId = await pollFor(
        async () =>
          await window.evaluate(async projectNameInput => {
            const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
            if (!raw) {
              return null
            }

            try {
              const parsed = JSON.parse(raw) as {
                workspaces?: Array<{ id?: string; name?: string }>
              }
              const workspace =
                parsed.workspaces?.find(candidate => candidate?.name === projectNameInput) ?? null
              return typeof workspace?.id === 'string' ? workspace.id : null
            } catch {
              return null
            }
          }, projectName),
        { label: 'created project id' },
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

                const directoryPath =
                  typeof last.directoryPath === 'string' ? last.directoryPath : ''
                const targetMountId =
                  typeof last.targetMountId === 'string' ? last.targetMountId : null

                if (!targetMountId || normalizedRepoRoots.length === 0) {
                  return null
                }

                if (!normalizedRepoRoots.includes(normalize(directoryPath))) {
                  return null
                }

                return { spaceId: last.id, directoryPath, targetMountId }
              } catch {
                return null
              }
            },
            { projectId: workspaceId, repoRoots: [remoteRepoDir, remoteRepoDirCanonical] },
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

      const branchName = `space/dev-profile-${Date.now()}`
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
              projectId: workspaceId,
              spaceId: spaceMeta.spaceId,
              repoRoots: [remoteRepoDir, remoteRepoDirCanonical],
            },
          ),
        { label: 'space worktree directory' },
      )

      const worktreePathCanonical = await realpath(worktreePath).catch(() => worktreePath)
      const cwdHashes = new Set([
        ...toShaCandidates(worktreePath),
        ...toShaCandidates(worktreePathCanonical),
      ])

      const filesPill = window.locator(`[data-testid="workspace-space-files-${spaceMeta.spaceId}"]`)
      await expect(filesPill).toBeVisible()
      await filesPill.click()

      const explorer = window.locator('[data-testid="workspace-space-explorer"]')
      await expect(explorer).toBeVisible()

      const readmeEntry = explorer
        .locator(`[data-testid^="workspace-space-explorer-entry-${spaceMeta.spaceId}-"]`)
        .filter({ hasText: 'README.md' })
        .first()
      await expect(readmeEntry).toBeVisible({ timeout: 20_000 })

      await readmeEntry.dblclick()
      const documentNode = window.locator('.document-node').filter({ hasText: 'README.md' }).first()
      await expect(documentNode).toBeVisible()

      await window.keyboard.press('Escape')
      await expect(explorer).toBeHidden()

      const terminalCountBefore = await window.locator('.terminal-node').count()
      const spaceRegion = window.locator('.workspace-space-region', { has: filesPill }).first()
      await expect(spaceRegion).toBeVisible()

      const contextMenuPosition = await pane.evaluate((paneEl, spaceTestId) => {
        const paneRect = paneEl.getBoundingClientRect()
        const spaceEl = document
          .querySelector(`[data-testid="${spaceTestId}"]`)
          ?.closest('.workspace-space-region')

        if (!spaceEl) {
          return { x: 320, y: 220 }
        }

        const spaceRect = spaceEl.getBoundingClientRect()
        const blocks = Array.from(
          document.querySelectorAll(
            '.terminal-node, .task-node, .note-node, .website-node, .document-node, .workspace-space-region__label-group',
          ),
        ).map(el => el.getBoundingClientRect())

        const marginX = 36
        const marginY = 52

        const candidates = [
          { x: spaceRect.left + marginX, y: spaceRect.top + marginY },
          { x: spaceRect.right - marginX, y: spaceRect.top + marginY },
          { x: spaceRect.left + marginX, y: spaceRect.bottom - marginY },
          { x: spaceRect.right - marginX, y: spaceRect.bottom - marginY },
          { x: (spaceRect.left + spaceRect.right) / 2, y: spaceRect.bottom - marginY },
          { x: spaceRect.left + marginX, y: (spaceRect.top + spaceRect.bottom) / 2 },
        ]

        const isBlocked = (absX: number, absY: number): boolean =>
          blocks.some(
            rect =>
              absX >= rect.x &&
              absX <= rect.x + rect.width &&
              absY >= rect.y &&
              absY <= rect.y + rect.height,
          )

        for (const point of candidates) {
          const absX = point.x
          const absY = point.y
          if (
            absX <= paneRect.left ||
            absX >= paneRect.right ||
            absY <= paneRect.top ||
            absY >= paneRect.bottom
          ) {
            continue
          }

          if (!isBlocked(absX, absY)) {
            return { x: absX - paneRect.left, y: absY - paneRect.top }
          }
        }

        return { x: 320, y: 220 }
      }, `workspace-space-files-${spaceMeta.spaceId}`)

      await pane.click({ button: 'right', position: contextMenuPosition, force: true })
      await window.locator('[data-testid="workspace-context-new-terminal"]').click()

      await expect(window.locator('.terminal-node')).toHaveCount(terminalCountBefore + 1)
      const terminal = window.locator('.terminal-node').nth(terminalCountBefore)
      await expect(terminal.locator('.xterm')).toBeVisible()
      await terminal.locator('.xterm').click()

      await expect(terminal.locator('.xterm-helper-textarea')).toBeFocused()
      await window.waitForTimeout(250)

      const cwdToken = `OPENCOVE_M6_DEV_PROFILE_WORKTREE_CWD_SHA_${Date.now()}:`
      await window.keyboard.type(
        buildNodeEvalCommand(
          `const crypto = require('crypto')\n` +
            `const digest = crypto.createHash('sha1').update(process.cwd().replace(/[\\\\/]+$/, '')).digest('hex').slice(0, 12)\n` +
            `process.stdout.write(${JSON.stringify(cwdToken)} + digest + '\\n')`,
        ),
      )
      await window.keyboard.press('Enter')

      await expect
        .poll(async () => {
          const text = (await terminal.textContent()) ?? ''
          return [...cwdHashes].some(hash => text.includes(`${cwdToken}${hash}`))
        })
        .toBe(true)

      // Cleanup: remove project and endpoint.
      await projectItem.click({ button: 'right' })
      await window.locator(`[data-testid="workspace-project-remove-${workspaceId}"]`).click()
      await expect(
        window.locator('[data-testid="workspace-project-delete-confirmation"]'),
      ).toBeVisible()
      await window.locator('[data-testid="workspace-project-delete-confirm"]').click()

      await openSettings(window)
      await switchSettingsPage(window, 'endpoints')
      const removeRow = window.locator('.settings-panel__row', { hasText: endpointDisplayName })
      await expect(removeRow).toBeVisible()
      await removeRow.locator('[data-testid^="settings-endpoints-remove-"]').click()
      await expect(
        window.locator('.settings-panel__row', { hasText: endpointDisplayName }),
      ).toHaveCount(0)
      await closeSettings(window)
    } catch (error) {
      process.stderr.write(`[dev-profile] Remote worker logs:\n${remoteWorker.logs()}\n`)
      throw error
    } finally {
      await electronApp.close().catch(() => undefined)
      await stopRemoteWorker(remoteWorker.child).catch(() => undefined)
      await removePathWithRetry(remoteWorkerUserDataDir)
      await removePathWithRetry(remoteBaseDir)
    }
  })
})
