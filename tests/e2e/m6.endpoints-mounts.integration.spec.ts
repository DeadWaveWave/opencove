import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { toFileUri } from '../../src/contexts/filesystem/domain/fileUri'
import type { GetSessionResult } from '../../src/shared/contracts/dto'
import { buildNodeEvalCommand, launchApp, removePathWithRetry } from './workspace-canvas.helpers'
import {
  createMultiMountProjectViaWizard,
  createRemoteOnlyProjectViaWizard,
} from './m6.endpoints-mounts.addProjectWizard.steps'
import { verifyRemoteOnlyProjectDefaultMount } from './m6.endpoints-mounts.remoteOnly.steps'
import {
  closeSettings,
  explorerEntry,
  openSettings,
  pathExists,
  pollFor,
  reserveLoopbackPort,
  startRemoteWorker,
  stopRemoteWorker,
  switchSettingsPage,
} from './m6.endpoints-mounts.integration.helpers'
test.describe('M6 - Desktop endpoints/mounts integration', () => {
  test.setTimeout(180_000)
  test('registers endpoint, creates projects, and routes space/terminal/agent via remote mount', async () => {
    const remoteToken = `m6-e2e-${randomUUID()}`
    const remotePort = await reserveLoopbackPort()
    const remoteHost = '127.0.0.1'
    const remoteBaseDir = await mkdtemp(path.join(tmpdir(), 'opencove-e2e-m6-remote-'))
    const remoteOnlyDir = path.join(remoteBaseDir, 'remote-only')
    const multiRemoteDir = path.join(remoteBaseDir, 'multi-remote')
    await mkdir(remoteOnlyDir, { recursive: true })
    await mkdir(multiRemoteDir, { recursive: true })
    const remoteOnlyDirCanonical = await realpath(remoteOnlyDir).catch(() => remoteOnlyDir)
    const remoteOnlyDirHashes = new Set([
      createHash('sha1').update(remoteOnlyDir).digest('hex').slice(0, 12),
      createHash('sha1').update(remoteOnlyDirCanonical).digest('hex').slice(0, 12),
    ])
    const multiRemoteDirCanonical = await realpath(multiRemoteDir).catch(() => multiRemoteDir)
    const multiRemoteDirHashes = new Set([
      createHash('sha1').update(multiRemoteDir).digest('hex').slice(0, 12),
      createHash('sha1').update(multiRemoteDirCanonical).digest('hex').slice(0, 12),
    ])
    const remoteSeedFile = path.join(multiRemoteDir, 'seed.txt')
    await writeFile(remoteSeedFile, 'seed', 'utf8')
    const remoteWorkerUserDataDir = await mkdtemp(
      path.join(tmpdir(), 'opencove-e2e-m6-remote-worker-'),
    )
    const remoteWorkerHomeDir = remoteBaseDir
    const remoteWorker = await startRemoteWorker({
      hostname: remoteHost,
      port: remotePort,
      token: remoteToken,
      userDataDir: remoteWorkerUserDataDir,
      homeDir: remoteWorkerHomeDir,
      approveRoot: remoteBaseDir,
      agentSessionScenario: 'codex-standby-only',
    })
    const { electronApp, window } = await launchApp({
      env: {
        OPENCOVE_TEST_AGENT_SESSION_SCENARIO: 'codex-standby-only',
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
              experimentalRemoteWorkersEnabled: true,
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
      const endpointDisplayName = 'Local Remote Worker'
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
        { label: 'remote endpoint id', timeoutMs: 30_000 },
      )

      await closeSettings(window)

      const remoteOnlyProjectName = 'Remote Only'
      await createRemoteOnlyProjectViaWizard({
        window,
        projectName: remoteOnlyProjectName,
        remoteEndpointId,
        remoteRootPath: remoteOnlyDir,
      })

      const remoteOnlySidebarItem = window
        .locator('.workspace-sidebar [data-testid^="workspace-item-"]')
        .filter({ hasText: remoteOnlyProjectName })
        .first()
      await expect(remoteOnlySidebarItem).toBeVisible()
      await expect(remoteOnlySidebarItem).not.toContainText(remoteOnlyDir)
      await expect
        .poll(async () => {
          return (
            (await remoteOnlySidebarItem.locator('.workspace-item__subtitle').textContent()) ?? ''
          )
        })
        .toContain(path.basename(remoteOnlyDir))

      await verifyRemoteOnlyProjectDefaultMount({
        window,
        projectName: remoteOnlyProjectName,
        remoteEndpointId,
        remoteOnlyDir,
        remoteOnlyDirHashes,
      })

      const multiMountProjectName = 'Multi Mount'
      await createMultiMountProjectViaWizard({
        window,
        projectName: multiMountProjectName,
        localRootPath: path.resolve(__dirname, '../../'),
        remoteEndpointId,
        remoteRootPath: multiRemoteDir,
        remoteMountName: 'RemoteMount',
      })

      const multiSidebarItem = window
        .locator('.workspace-sidebar [data-testid^="workspace-item-"]')
        .filter({ hasText: multiMountProjectName })
        .first()
      await expect(multiSidebarItem).toBeVisible()
      await expect(multiSidebarItem).not.toContainText(multiRemoteDir)
      await expect(multiSidebarItem).not.toContainText(path.resolve(__dirname, '../../'))
      await expect
        .poll(async () => {
          return (await multiSidebarItem.locator('.workspace-item__subtitle').textContent()) ?? ''
        })
        .toContain('(+1)')

      await multiSidebarItem.click({ noWaitAfter: true })

      await multiSidebarItem.click({ button: 'right', force: true })
      await window.locator('[data-testid^="workspace-project-manage-mounts-"]').click()
      await expect(
        window.locator('[data-testid="workspace-project-mount-manager-window"]'),
      ).toBeVisible()
      await expect(window.locator('[data-testid^="workspace-project-mount-remove-"]')).toHaveCount(
        2,
      )
      await window.locator('[data-testid="workspace-project-mount-close"]').click()
      await expect(
        window.locator('[data-testid="workspace-project-mount-manager-window"]'),
      ).toHaveCount(0)

      const multiProjectId = await pollFor(
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
          }, multiMountProjectName),
        { label: 'multi-mount project id', timeoutMs: 30_000 },
      )

      const remoteMountId = await pollFor(
        async () =>
          await window.evaluate(
            async ({ projectId, endpointId }) => {
              const mountResult = await window.opencoveApi.controlSurface.invoke<{
                mounts: Array<{ mountId: string; endpointId: string }>
              }>({
                kind: 'query',
                id: 'mount.list',
                payload: { projectId },
              })
              const match =
                mountResult.mounts.find(mount => mount.endpointId === endpointId) ?? null
              return match?.mountId ?? null
            },
            { projectId: multiProjectId, endpointId: remoteEndpointId },
          ),
        { label: 'remote mount id', timeoutMs: 30_000 },
      )

      const pane = window.locator('.workspace-canvas .react-flow__pane')
      await expect(pane).toBeVisible()

      await pane.click({ button: 'right', position: { x: 320, y: 220 } })
      await window.locator('[data-testid="workspace-context-new-terminal"]').click()
      await expect(window.locator('.terminal-node')).toHaveCount(1)

      const firstTerminal = window.locator('.terminal-node').first()
      const firstHeader = firstTerminal.locator('.terminal-node__header')
      await firstHeader.click({ position: { x: 40, y: 20 } })
      await firstTerminal.click({ button: 'right' })
      await window.locator('[data-testid="workspace-selection-create-space"]').click()

      await expect(
        window.locator('[data-testid="workspace-space-target-mount-window"]'),
      ).toBeVisible()
      await window.locator(`[data-testid="workspace-space-target-mount-${remoteMountId}"]`).check()
      await window.locator('[data-testid="workspace-space-target-mount-confirm"]').click()
      await expect(
        window.locator('[data-testid="workspace-space-target-mount-window"]'),
      ).toHaveCount(0)

      const spaceId = await pollFor(
        async () =>
          await window.evaluate(
            async ({ projectId, mountId }) => {
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
                  parsed.workspaces?.find(candidate => candidate?.id === projectId) ?? null
                const spaces = workspace?.spaces
                if (!Array.isArray(spaces) || spaces.length === 0) {
                  return null
                }

                const last = spaces[spaces.length - 1]
                if (!last || typeof last.id !== 'string') {
                  return null
                }

                if (last.targetMountId !== mountId) {
                  return null
                }

                return last.id
              } catch {
                return null
              }
            },
            { projectId: multiProjectId, mountId: remoteMountId },
          ),
        { label: 'created space id', timeoutMs: 30_000 },
      )

      await window
        .locator(`[data-testid="workspace-space-files-${spaceId}"]`)
        .click({ noWaitAfter: true })
      const explorer = window.locator('[data-testid="workspace-space-explorer"]')
      await expect(explorer).toBeVisible()

      const seedEntry = explorerEntry(window, spaceId, toFileUri(remoteSeedFile))
      await expect(seedEntry).toBeVisible()

      await explorer.getByRole('button', { name: 'New File' }).click()
      const createInput = explorer.locator('.workspace-space-explorer__create-input')
      await expect(createInput).toBeVisible()
      const createdFileName = 'created-from-remote.txt'
      await createInput.fill(createdFileName)
      await createInput.press('Enter')

      const createdFilePath = path.join(multiRemoteDir, createdFileName)
      const createdFileUri = toFileUri(createdFilePath)
      const createdFileReady = await expect
        .poll(async () => await pathExists(createdFilePath), { timeout: 15_000 })
        .toBeTruthy()
        .then(
          () => true,
          () => false,
        )

      if (!createdFileReady) {
        const createErrorText = await explorer
          .locator('.workspace-space-explorer__create-error')
          .textContent()
          .catch(() => null)
        const directWriteAttempt = await window.evaluate(
          async ({ mountId, uri }) => {
            try {
              await window.opencoveApi.controlSurface.invoke({
                kind: 'command',
                id: 'filesystem.writeFileTextInMount',
                payload: { mountId, uri, content: '' },
              })
              return { ok: true as const, error: null }
            } catch (error) {
              const record =
                error && typeof error === 'object' ? (error as Record<string, unknown>) : null
              return {
                ok: false as const,
                error: record
                  ? {
                      name: record.name ?? null,
                      message: record.message ?? null,
                      code: record.code ?? null,
                      debugMessage: record.debugMessage ?? null,
                    }
                  : { name: null, message: String(error), code: null, debugMessage: null },
              }
            }
          },
          { mountId: remoteMountId, uri: createdFileUri },
        )

        throw new Error(
          `[e2e] Explorer create file did not produce ${createdFilePath}.\n` +
            `UI error: ${createErrorText ?? '[none]'}\n` +
            `Direct write ok: ${String(directWriteAttempt.ok)}\n` +
            `Direct write error: ${directWriteAttempt.ok ? '[none]' : JSON.stringify(directWriteAttempt.error)}\n`,
        )
      }

      const terminalCountBefore = await window.locator('.terminal-node').count()
      const spaceFilesPill = window.locator(`[data-testid="workspace-space-files-${spaceId}"]`)
      const spaceRegion = window.locator('.workspace-space-region', { has: spaceFilesPill })
      await expect(spaceRegion).toBeVisible()

      const paneBox = await pane.boundingBox()
      const spaceBox = await spaceRegion.boundingBox()
      if (!paneBox || !spaceBox) {
        throw new Error('[e2e] Missing bounding box for pane/space region')
      }

      const clickPoint = {
        x: Math.max(8, Math.min(spaceBox.x + spaceBox.width - 24, paneBox.x + paneBox.width - 8)),
        y: Math.max(8, Math.min(spaceBox.y + spaceBox.height - 24, paneBox.y + paneBox.height - 8)),
      }

      await pane.click({
        button: 'right',
        position: { x: clickPoint.x - paneBox.x, y: clickPoint.y - paneBox.y },
      })
      await window.locator('[data-testid="workspace-context-new-terminal"]').click()

      await expect(window.locator('.terminal-node')).toHaveCount(terminalCountBefore + 1)
      const remoteTerminal = window.locator('.terminal-node').nth(terminalCountBefore)
      await expect(remoteTerminal.locator('.xterm')).toBeVisible()
      await remoteTerminal.locator('.xterm').click()

      await expect(remoteTerminal.locator('.xterm-helper-textarea')).toBeFocused()
      await window.waitForTimeout(250)
      const cwdToken = `OPENCOVE_M6_REMOTE_CWD_SHA_${Date.now()}:`
      await window.keyboard.type(
        buildNodeEvalCommand(
          `const crypto = require('crypto')\n` +
            `const digest = crypto.createHash('sha1').update(process.cwd()).digest('hex').slice(0, 12)\n` +
            `process.stdout.write(${JSON.stringify(cwdToken)} + digest + '\\n')`,
        ),
      )
      await window.keyboard.press('Enter')
      await expect
        .poll(
          async () => {
            const text = (await remoteTerminal.textContent()) ?? ''
            return [...multiRemoteDirHashes].some(hash => text.includes(`${cwdToken}${hash}`))
          },
          { timeout: 20_000 },
        )
        .toBe(true)

      await pane.click({
        button: 'right',
        position: { x: clickPoint.x - paneBox.x, y: clickPoint.y - paneBox.y },
      })
      const terminalCountBeforeAgent = await window.locator('.terminal-node').count()
      await window.locator('[data-testid="workspace-context-run-default-agent"]').click()
      await expect(window.locator('.terminal-node')).toHaveCount(terminalCountBeforeAgent + 1)
      const agentNode = window.locator('.terminal-node').nth(terminalCountBeforeAgent)
      await expect(agentNode).toContainText('[opencove-test-agent]')

      const agentSessionId = await pollFor(
        async () =>
          await window.evaluate(async () => {
            return window.__opencoveWorkspaceCanvasTestApi?.getFirstAgentSessionId?.() ?? null
          }),
        { timeoutMs: 30_000, label: 'agent session id' },
      )

      const session = await window.evaluate(async sessionId => {
        return await window.opencoveApi.controlSurface.invoke<GetSessionResult>({
          kind: 'query',
          id: 'session.get',
          payload: { sessionId },
        })
      }, agentSessionId)

      expect(session.executionContext.endpoint.endpointId).toBe(remoteEndpointId)
      expect(session.executionContext.mountId).toBe(remoteMountId)
      expect(session.executionContext.target.rootPath).toBe(multiRemoteDir)

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
