import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { launchApp, removePathWithRetry, selectCoveOption } from './workspace-canvas.helpers'
import {
  closeSettings,
  openSettings,
  pollFor,
  reserveLoopbackPort,
  startRemoteWorker,
  stopRemoteWorker,
  switchSettingsPage,
} from './m6.endpoints-mounts.integration.helpers'

const auditOutputDir = path.resolve(__dirname, '../../.opencove/ui-audit/remote-dark')

async function ensureAuditDir(): Promise<void> {
  await mkdir(auditOutputDir, { recursive: true })
}

test.describe('Remote UI audit', () => {
  test.setTimeout(180_000)

  test('captures the remote UI surfaces for visual review', async () => {
    await ensureAuditDir()

    const remoteToken = 'ui-audit-token'
    const remotePort = await reserveLoopbackPort()
    const remoteHost = '127.0.0.1'

    const remoteBaseDir = await mkdtemp(path.join(tmpdir(), 'opencove-ui-audit-remote-'))
    const remoteProjectDir = path.join(remoteBaseDir, 'Design Review Project')
    await mkdir(remoteProjectDir, { recursive: true })
    await writeFile(path.join(remoteProjectDir, 'README.md'), '# UI audit\n', 'utf8')

    const remoteWorkerUserDataDir = await mkdtemp(
      path.join(tmpdir(), 'opencove-ui-audit-remote-worker-'),
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

    try {
      const resetResult = await window.evaluate(async () => {
        return await window.opencoveApi.persistence.writeWorkspaceStateRaw({
          raw: JSON.stringify({
            formatVersion: 1,
            activeWorkspaceId: null,
            workspaces: [],
            settings: {
              uiTheme: 'dark',
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

      const endpointDisplayName = 'Design Review Endpoint'

      await openSettings(window)
      await switchSettingsPage(window, 'endpoints')

      await window
        .locator(
          '[data-testid="settings-endpoints-open-register"], [data-testid="settings-endpoints-empty-register"]',
        )
        .first()
        .click()
      await expect(
        window.locator('[data-testid="settings-endpoints-register-window"]'),
      ).toBeVisible()
      await window
        .locator('[data-testid="settings-endpoints-register-window"]')
        .screenshot({ path: path.join(auditOutputDir, '01-register-managed.png') })

      await window.locator('[data-testid="settings-endpoints-register-mode-manual"]').click()
      await expect(
        window.locator('[data-testid="settings-endpoints-register-manual-hostname"]'),
      ).toBeVisible()
      await window
        .locator('[data-testid="settings-endpoints-register-window"]')
        .screenshot({ path: path.join(auditOutputDir, '02-register-manual.png') })

      await window
        .locator('[data-testid="settings-endpoints-register-displayName"]')
        .fill(endpointDisplayName)
      await window
        .locator('[data-testid="settings-endpoints-register-manual-hostname"]')
        .fill(remoteHost)
      await window
        .locator('[data-testid="settings-endpoints-register-port"]')
        .fill(String(remotePort))
      await window.locator('[data-testid="settings-endpoints-register-token"]').fill(remoteToken)
      await window.locator('[data-testid="settings-endpoints-register-submit"]').click()
      await expect(
        window.locator('[data-testid="settings-endpoints-register-window"]'),
      ).toHaveCount(0)

      const endpointRow = window.locator('.settings-panel__endpoint-card', {
        hasText: endpointDisplayName,
      })
      await expect(endpointRow).toBeVisible()
      await window.evaluate(async displayName => {
        const endpoints = await window.opencoveApi.controlSurface.invoke<{
          endpoints: Array<{ endpointId: string; displayName: string }>
        }>({
          kind: 'query',
          id: 'endpoint.list',
          payload: null,
        })
        const endpoint =
          endpoints.endpoints.find(
            candidate => candidate.displayName === displayName && candidate.endpointId !== 'local',
          ) ?? null
        if (!endpoint) {
          throw new Error(`Unable to resolve endpoint for ${displayName}`)
        }

        await window.opencoveApi.controlSurface.invoke({
          kind: 'command',
          id: 'endpoint.prepare',
          payload: { endpointId: endpoint.endpointId, reason: 'connect' },
        })
        window.dispatchEvent(new Event('opencove:endpoint-overviews-changed'))
      }, endpointDisplayName)
      await expect(endpointRow).toContainText('Connected')
      await window
        .locator('#settings-section-endpoints')
        .screenshot({ path: path.join(auditOutputDir, '03-settings-endpoints.png') })

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

      await window.locator('[data-testid="sidebar-add-project"]').click({ noWaitAfter: true })
      const projectWizard = window.locator('[data-testid="workspace-project-create-window"]')
      await expect(projectWizard).toBeVisible()
      await window.locator('[data-testid="workspace-project-create-name"]').fill('UI Audit Project')
      await window
        .locator('[data-testid="workspace-project-create-default-location-remote"]')
        .click({ noWaitAfter: true })
      await selectCoveOption(
        window,
        'workspace-project-create-default-remote-endpoint',
        remoteEndpointId,
      )
      await projectWizard.screenshot({
        path: path.join(auditOutputDir, '04-add-project-default-remote.png'),
      })

      await window.locator('[data-testid="workspace-project-create-advanced-toggle"]').click()
      await expect(
        window.locator('[data-testid="workspace-project-create-extra-remote-endpoint-trigger"]'),
      ).toBeVisible()
      await projectWizard.screenshot({
        path: path.join(auditOutputDir, '05-add-project-advanced-remote.png'),
      })

      await window.locator('[data-testid="workspace-project-create-default-remote-browse"]').click()
      const picker = window.locator('[data-testid="remote-directory-picker-window"]')
      await expect(picker).toBeVisible()
      const entry = window
        .locator('[data-testid^="remote-directory-picker-entry-"]')
        .filter({ hasText: path.basename(remoteProjectDir) })
        .first()
      await expect(entry).toBeVisible()
      await picker.screenshot({ path: path.join(auditOutputDir, '06-remote-directory-picker.png') })

      await entry.click()
      await window.locator('[data-testid="remote-directory-picker-select"]').click()
      await expect(picker).toHaveCount(0)

      await window.locator('[data-testid="workspace-project-create-confirm"]').click()
      await expect(projectWizard).toHaveCount(0)

      const projectItem = window
        .locator('.workspace-sidebar [data-testid^="workspace-item-"]')
        .filter({ hasText: 'UI Audit Project' })
        .first()
      await expect(projectItem).toBeVisible()
      await projectItem.click({ noWaitAfter: true })
      await projectItem.click({ button: 'right', force: true })
      await window.locator('[data-testid^="workspace-project-manage-mounts-"]').click()

      const mountManager = window.locator('[data-testid="workspace-project-mount-manager-window"]')
      await expect(mountManager).toBeVisible()
      await mountManager.screenshot({
        path: path.join(auditOutputDir, '07-project-mount-manager.png'),
      })

      await electronApp.close()
    } finally {
      await stopRemoteWorker(remoteWorker.child).catch(() => undefined)
      await removePathWithRetry(remoteBaseDir).catch(() => undefined)
      await removePathWithRetry(remoteWorkerUserDataDir).catch(() => undefined)
    }
  })
})