import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { removePathWithRetry, launchApp } from './workspace-canvas.helpers'
import { createFakeManagedSshInstallDir } from './fake-managed-ssh'
import { createRemoteOnlyProjectViaWizard } from './m6.endpoints-mounts.addProjectWizard.steps'
import {
  closeSettings,
  openSettings,
  pollFor,
  reserveLoopbackPort,
  startRemoteWorker,
  stopRemoteWorker,
  switchSettingsPage,
  type RemoteWorkerHandle,
} from './m6.endpoints-mounts.integration.helpers'

const ENDPOINT_SECRETS_FILE = 'worker-endpoint-secrets.json'

async function readManagedEndpointToken(userDataDir: string, endpointId: string): Promise<string> {
  return await pollFor(
    async () => {
      try {
        const raw = await readFile(path.join(userDataDir, ENDPOINT_SECRETS_FILE), 'utf8')
        const parsed = JSON.parse(raw) as {
          tokensByCredentialRef?: Record<string, unknown>
        }
        const token = parsed.tokensByCredentialRef?.[endpointId]
        return typeof token === 'string' && token.trim().length > 0 ? token : null
      } catch {
        return null
      }
    },
    { label: 'managed endpoint token' },
  )
}

test.describe('M6 - Managed SSH remote endpoint integration', () => {
  test.setTimeout(180_000)

  test('connects through managed SSH and creates a remote-only project via browse', async () => {
    const remoteHost = '127.0.0.1'
    const remoteSshPort = 2222
    const remoteWorkerPort = await reserveLoopbackPort()

    const remoteBaseDir = await mkdtemp(path.join(tmpdir(), 'opencove-e2e-managed-ssh-remote-'))
    const remoteProjectDir = path.join(remoteBaseDir, 'Managed SSH Project')
    await mkdir(remoteProjectDir, { recursive: true })
    await writeFile(path.join(remoteProjectDir, 'README.md'), '# managed ssh\n', 'utf8')

    const remoteWorkerUserDataDir = await mkdtemp(
      path.join(tmpdir(), 'opencove-e2e-managed-ssh-worker-'),
    )
    const appUserDataDir = await mkdtemp(path.join(tmpdir(), 'opencove-e2e-managed-ssh-app-'))
    const fakeSshInstallDir = await createFakeManagedSshInstallDir()

    let remoteWorker: RemoteWorkerHandle | null = null
    const { electronApp, window } = await launchApp({
      userDataDir: appUserDataDir,
      env: {
        OPENCOVE_TEST_AGENT_SESSION_SCENARIO: 'codex-standby-only',
        PATH: `${fakeSshInstallDir}${path.delimiter}${process.env['PATH'] ?? ''}`,
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

      const endpointDisplayName = `Managed SSH Endpoint ${randomUUID().slice(0, 8)}`
      await openSettings(window)
      await switchSettingsPage(window, 'endpoints')
      await window
        .locator(
          '[data-testid="settings-endpoints-open-register"], [data-testid="settings-endpoints-empty-register"]',
        )
        .first()
        .click()

      await expect(
        window.locator('[data-testid="settings-endpoints-register-mode-managed"]'),
      ).toBeVisible()
      await window
        .locator('[data-testid="settings-endpoints-register-displayName"]')
        .fill(endpointDisplayName)
      await window.locator('[data-testid="settings-endpoints-register-hostname"]').fill(remoteHost)
      await window.locator('[data-testid="settings-endpoints-register-username"]').fill('tester')
      await window
        .locator('[data-testid="settings-endpoints-register-ssh-port"]')
        .fill(String(remoteSshPort))
      await window
        .locator('[data-testid="settings-endpoints-register-remote-port"]')
        .fill(String(remoteWorkerPort))
      await window.locator('[data-testid="settings-endpoints-register-submit"]').click()
      await expect(
        window.locator('[data-testid="settings-endpoints-register-window"]'),
      ).toHaveCount(0)

      const endpointRow = window.locator('.settings-panel__endpoint-card', {
        hasText: endpointDisplayName,
      })
      await expect(endpointRow).toBeVisible()
      await expect(endpointRow).toContainText('Managed SSH')
      await expect(endpointRow).toContainText('Disconnected')

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
            const endpoint =
              result.endpoints.find(
                candidate =>
                  candidate.displayName === displayName && candidate.endpointId !== 'local',
              ) ?? null
            return endpoint?.endpointId ?? null
          }, endpointDisplayName),
        { label: 'managed remote endpoint id' },
      )

      const endpointToken = await readManagedEndpointToken(appUserDataDir, remoteEndpointId)
      remoteWorker = await startRemoteWorker({
        hostname: remoteHost,
        port: remoteWorkerPort,
        token: endpointToken,
        userDataDir: remoteWorkerUserDataDir,
        homeDir: remoteBaseDir,
        approveRoot: remoteBaseDir,
        agentSessionScenario: 'codex-standby-only',
      })

      await endpointRow.getByRole('button', { name: 'Connect', exact: true }).click()
      await expect(endpointRow).toContainText('Connected')
      await expect(
        endpointRow.getByRole('button', { name: 'Reconnect', exact: true }),
      ).toBeVisible()

      await closeSettings(window)

      const projectName = `Managed SSH Project (${Date.now()})`
      await createRemoteOnlyProjectViaWizard({
        window,
        projectName,
        remoteEndpointId,
        remoteRootPath: remoteProjectDir,
      })

      const projectItem = window
        .locator('.workspace-sidebar [data-testid^="workspace-item-"]')
        .filter({ hasText: projectName })
        .first()
      await expect(projectItem).toBeVisible()

      await pollFor(
        async () =>
          await window.evaluate(
            async ({ expectedProjectName, expectedPath, expectedEndpointId }) => {
              const normalize = (value: string): string => value.trim().replace(/[\\/]+$/, '')
              const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
              if (!raw) {
                return null
              }

              try {
                const parsed = JSON.parse(raw) as {
                  workspaces?: Array<{ id?: string; name?: string; path?: string }>
                }
                const workspace =
                  parsed.workspaces?.find(candidate => candidate?.name === expectedProjectName) ??
                  null
                if (!workspace || typeof workspace.id !== 'string') {
                  return null
                }

                const mounts = await window.opencoveApi.controlSurface.invoke<{
                  mounts: Array<{ endpointId: string; rootPath: string }>
                }>({
                  kind: 'query',
                  id: 'mount.list',
                  payload: { projectId: workspace.id },
                })
                const matchedMount =
                  mounts.mounts.find(
                    mount =>
                      mount.endpointId === expectedEndpointId &&
                      normalize(mount.rootPath) === normalize(expectedPath),
                  ) ?? null
                return matchedMount ? true : null
              } catch {
                return null
              }
            },
            {
              expectedProjectName: projectName,
              expectedPath: remoteProjectDir,
              expectedEndpointId: remoteEndpointId,
            },
          ),
        { label: 'managed remote mount binding' },
      )
    } catch (error) {
      if (remoteWorker) {
        process.stderr.write(`[e2e] Managed SSH remote worker logs:\n${remoteWorker.logs()}\n`)
      }
      throw error
    } finally {
      await electronApp.close().catch(() => undefined)
      if (remoteWorker) {
        await stopRemoteWorker(remoteWorker.child).catch(() => undefined)
      }
      await removePathWithRetry(fakeSshInstallDir)
      await removePathWithRetry(remoteWorkerUserDataDir)
      await removePathWithRetry(remoteBaseDir)
      await removePathWithRetry(appUserDataDir)
    }
  })
})
