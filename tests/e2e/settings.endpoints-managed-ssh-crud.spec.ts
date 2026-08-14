import { mkdir, mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test'
import { createFakeManagedSshInstallDir } from './fake-managed-ssh'
import {
  openSettings,
  pollFor,
  reserveLoopbackPort,
  startRemoteWorker,
  stopRemoteWorker,
  switchSettingsPage,
  type RemoteWorkerHandle,
} from './m6.endpoints-mounts.integration.helpers'
import { launchApp, removePathWithRetry, selectCoveOption } from './workspace-canvas.helpers'

async function readEndpointToken(userDataPath: string, endpointId: string): Promise<string> {
  return await pollFor(
    async () => {
      try {
        const parsed = JSON.parse(
          await readFile(path.join(userDataPath, 'worker-endpoint-secrets.json'), 'utf8'),
        ) as { tokensByCredentialRef?: Record<string, unknown> }
        const token = parsed.tokensByCredentialRef?.[endpointId]
        return typeof token === 'string' && token.length > 0 ? token : null
      } catch {
        return null
      }
    },
    { label: 'managed SSH endpoint token' },
  )
}

async function capture(locator: Locator, name: string, testInfo: TestInfo): Promise<void> {
  await testInfo.attach(name, {
    body: await locator.screenshot({ animations: 'disabled' }),
    contentType: 'image/png',
  })
}

async function selectTheme(window: Page, theme: 'light' | 'dark'): Promise<void> {
  await switchSettingsPage(window, 'appearance')
  await selectCoveOption(window, 'settings-ui-theme', theme)
  await expect(window.locator('html')).toHaveAttribute('data-cove-theme', theme)
  await switchSettingsPage(window, 'endpoints')
}

test.describe('Settings managed SSH endpoint CRUD', () => {
  test.setTimeout(180_000)

  test('edits, validates, and confirms removal impact in both themes', async ({
    browserName,
  }, testInfo) => {
    const remoteWorkerPort = await reserveLoopbackPort()
    const remoteBaseDir = await mkdtemp(
      path.join(tmpdir(), `opencove-e2e-ssh-crud-${browserName}-remote-`),
    )
    const remoteProjectDir = path.join(remoteBaseDir, 'project')
    const remoteWorkerUserDataDir = await mkdtemp(
      path.join(tmpdir(), 'opencove-e2e-ssh-crud-worker-'),
    )
    const appUserDataDir = await mkdtemp(path.join(tmpdir(), 'opencove-e2e-ssh-crud-app-'))
    const fakeSshInstallDir = await createFakeManagedSshInstallDir()
    await mkdir(remoteProjectDir, { recursive: true })

    let remoteWorker: RemoteWorkerHandle | null = null
    const { electronApp, window } = await launchApp({
      userDataDir: appUserDataDir,
      env: { PATH: `${fakeSshInstallDir}${path.delimiter}${process.env['PATH'] ?? ''}` },
    })

    try {
      const seeded = await window.evaluate(
        async () =>
          await window.opencoveApi.persistence.writeWorkspaceStateRaw({
            raw: JSON.stringify({
              formatVersion: 1,
              activeWorkspaceId: null,
              workspaces: [],
              settings: { experimentalRemoteWorkersEnabled: true, uiTheme: 'dark' },
            }),
          }),
      )
      expect(seeded.ok).toBe(true)
      await window.reload({ waitUntil: 'domcontentloaded' })
      await openSettings(window)
      await switchSettingsPage(window, 'endpoints')

      await window
        .locator(
          '[data-testid="settings-endpoints-open-register"], [data-testid="settings-endpoints-empty-register"]',
        )
        .first()
        .click()
      await window
        .locator('[data-testid="settings-endpoints-register-displayName"]')
        .fill('Build box')
      await window.locator('[data-testid="settings-endpoints-register-hostname"]').fill('127.0.0.1')
      await window.locator('[data-testid="settings-endpoints-register-username"]').fill('tester')
      await expect(
        window.locator('[data-testid="settings-endpoints-register-advanced"]'),
      ).not.toHaveAttribute('open')
      await window.locator('[data-testid="settings-endpoints-register-advanced-toggle"]').click()
      await window.locator('[data-testid="settings-endpoints-register-ssh-port"]').fill('2222')
      await window
        .locator('[data-testid="settings-endpoints-register-remote-port"]')
        .fill(String(remoteWorkerPort))
      await window.locator('[data-testid="settings-endpoints-register-submit"]').click()
      await expect(
        window.locator('[data-testid="settings-endpoints-register-window"]'),
      ).toHaveCount(0)

      const endpointId = await pollFor(
        async () =>
          await window.evaluate(async () => {
            const result = await window.opencoveApi.controlSurface.invoke<{
              endpoints: Array<{ endpointId: string; displayName: string }>
            }>({ kind: 'query', id: 'endpoint.list', payload: null })
            return (
              result.endpoints.find(endpoint => endpoint.displayName === 'Build box')?.endpointId ??
              null
            )
          }),
        { label: 'CRUD endpoint id' },
      )
      remoteWorker = await startRemoteWorker({
        hostname: '127.0.0.1',
        port: remoteWorkerPort,
        token: await readEndpointToken(appUserDataDir, endpointId),
        userDataDir: remoteWorkerUserDataDir,
        homeDir: remoteBaseDir,
        approveRoot: remoteBaseDir,
        agentSessionScenario: 'codex-standby-only',
      })

      const endpointCard = window.locator('.settings-panel__endpoint-card', {
        hasText: 'Build box',
      })
      await endpointCard.locator(`[data-testid="settings-endpoints-edit-${endpointId}"]`).click()
      await expect(
        window.locator('[data-testid="settings-endpoints-register-advanced"]'),
      ).toHaveAttribute('open')
      await capture(
        window.locator('[data-testid="settings-endpoints-register-window"]'),
        'managed-ssh-edit-dark',
        testInfo,
      )
      await window.locator('[data-testid="settings-endpoints-register-ssh-port"]').fill('2223')
      await window.locator('[data-testid="settings-endpoints-register-submit"]').click()
      await expect(endpointCard).toContainText('tester@127.0.0.1:2223')

      await window.locator('[data-testid="settings-endpoints-open-register"]').click()
      await window
        .locator('[data-testid="settings-endpoints-register-hostname"]')
        .fill('invalid.example.com')
      await window.locator('[data-testid="settings-endpoints-register-advanced-toggle"]').click()
      await window.locator('[data-testid="settings-endpoints-register-ssh-port"]').fill('abc')
      await expect(
        window.locator('[data-testid="settings-endpoints-register-ssh-port-error"]'),
      ).toContainText('Enter a whole-number port from 1 to 65535.')
      await expect(
        window.locator('[data-testid="settings-endpoints-register-submit"]'),
      ).toBeDisabled()
      await capture(
        window.locator('[data-testid="settings-endpoints-register-window"]'),
        'managed-ssh-invalid-port-dark',
        testInfo,
      )
      await window
        .locator('[data-testid="settings-endpoints-register-backdrop"]')
        .dispatchEvent('pointerdown')
      await expect(
        window.locator('[data-testid="settings-endpoints-register-window"]'),
      ).toBeVisible()
      await window.keyboard.press('Escape')
      await expect(
        window.locator('[data-testid="settings-endpoints-register-window"]'),
      ).toHaveCount(0)

      await window.locator('[data-testid="settings-endpoints-open-register"]').click()
      await window
        .locator('[data-testid="settings-endpoints-register-backdrop"]')
        .dispatchEvent('pointerdown')
      await expect(
        window.locator('[data-testid="settings-endpoints-register-window"]'),
      ).toHaveCount(0)

      await window.evaluate(
        async ({ selectedEndpointId, rootPath }) =>
          await window.opencoveApi.controlSurface.invoke({
            kind: 'command',
            id: 'mount.create',
            payload: {
              projectId: 'ssh-crud-project',
              endpointId: selectedEndpointId,
              rootPath,
            },
          }),
        { selectedEndpointId: endpointId, rootPath: remoteProjectDir },
      )
      await window.locator('[data-testid="settings-endpoints-refresh"]').click()

      await selectTheme(window, 'light')
      await window.locator('[data-testid="settings-endpoints-open-register"]').click()
      await window
        .locator('[data-testid="settings-endpoints-register-hostname"]')
        .fill('invalid.example.com')
      await window.locator('[data-testid="settings-endpoints-register-advanced-toggle"]').click()
      await window.locator('[data-testid="settings-endpoints-register-ssh-port"]').fill('abc')
      await expect(
        window.locator('[data-testid="settings-endpoints-register-ssh-port-error"]'),
      ).toContainText('Enter a whole-number port from 1 to 65535.')
      await capture(
        window.locator('[data-testid="settings-endpoints-register-window"]'),
        'managed-ssh-invalid-port-light',
        testInfo,
      )
      await window.locator('[data-testid="settings-endpoints-register-cancel"]').click()
      await endpointCard.locator(`[data-testid="settings-endpoints-edit-${endpointId}"]`).click()
      await capture(
        window.locator('[data-testid="settings-endpoints-register-window"]'),
        'managed-ssh-edit-light',
        testInfo,
      )
      await window.locator('[data-testid="settings-endpoints-register-cancel"]').click()
      await endpointCard.locator(`[data-testid="settings-endpoints-remove-${endpointId}"]`).click()
      await expect(
        window.locator('[data-testid="settings-endpoints-remove-impact"]'),
      ).toContainText('This will unbind 1 mount from the remote machine.')
      await capture(
        window.locator('[data-testid="settings-endpoints-remove-window"]'),
        'managed-ssh-remove-light',
        testInfo,
      )
      await window
        .locator('[data-testid="settings-endpoints-remove-backdrop"]')
        .dispatchEvent('pointerdown')
      await expect(window.locator('[data-testid="settings-endpoints-remove-window"]')).toBeVisible()
      await window.locator('[data-testid="settings-endpoints-remove-cancel"]').click()
      await expect(endpointCard).toBeVisible()

      await selectTheme(window, 'dark')
      await endpointCard.locator(`[data-testid="settings-endpoints-remove-${endpointId}"]`).click()
      await capture(
        window.locator('[data-testid="settings-endpoints-remove-window"]'),
        'managed-ssh-remove-dark',
        testInfo,
      )
      await window.locator('[data-testid="settings-endpoints-remove-confirm"]').click()
      await expect(endpointCard).toHaveCount(0)
      const mounts = await window.evaluate(
        async () =>
          await window.opencoveApi.controlSurface.invoke<{ mounts: unknown[] }>({
            kind: 'query',
            id: 'mount.list',
            payload: { projectId: 'ssh-crud-project' },
          }),
      )
      expect(mounts.mounts).toHaveLength(0)
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
