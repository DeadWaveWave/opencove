import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { openSettings, switchSettingsPage } from './m6.endpoints-mounts.integration.helpers'
import { launchApp, removePathWithRetry } from './workspace-canvas.helpers'

test.describe('Settings SSH config host picker', () => {
  test('prefills one alias from the real test HOME without registering it', async ({
    browserName,
  }, testInfo) => {
    const userDataDir = await mkdtemp(
      path.join(tmpdir(), `opencove-e2e-ssh-config-picker-${browserName}-`),
    )
    const sshDirectory = path.join(userDataDir, 'home', '.ssh')
    await mkdir(sshDirectory, { recursive: true })
    await writeFile(
      path.join(sshDirectory, 'config'),
      ['Host e2e-config-box', '  HostName 10.44.0.9', '  User deploy', '  Port 2201'].join('\n'),
    )

    const { electronApp, window } = await launchApp({
      userDataDir,
      cleanupUserDataDir: false,
    })

    try {
      const seeded = await window.evaluate(
        async () =>
          await window.opencoveApi.persistence.writeWorkspaceStateRaw({
            raw: JSON.stringify({
              formatVersion: 1,
              activeWorkspaceId: null,
              workspaces: [],
              settings: { experimentalRemoteWorkersEnabled: true },
            }),
          }),
      )
      expect(seeded.ok).toBe(true)
      await window.reload({ waitUntil: 'domcontentloaded' })
      await openSettings(window)
      await switchSettingsPage(window, 'endpoints')

      const endpointCountBefore = await window.evaluate(async () => {
        const result = await window.opencoveApi.controlSurface.invoke<{ endpoints: unknown[] }>({
          kind: 'query',
          id: 'endpoint.list',
          payload: null,
        })
        return result.endpoints.length
      })

      await window.locator('[data-testid="settings-endpoints-open-register"]').click()
      await window.locator('[data-testid="settings-endpoints-ssh-config-open"]').click()
      await expect(
        window.locator('[data-testid="settings-endpoints-ssh-config-host-e2e-config-box"]'),
      ).toContainText('deploy@10.44.0.9')
      await window
        .locator('[data-testid="settings-endpoints-ssh-config-host-e2e-config-box"]')
        .click()

      await expect(
        window.locator('[data-testid="settings-endpoints-register-displayName"]'),
      ).toHaveValue('e2e-config-box')
      await expect(
        window.locator('[data-testid="settings-endpoints-register-hostname"]'),
      ).toHaveValue('e2e-config-box')
      await expect(
        window.locator('[data-testid="settings-endpoints-register-username"]'),
      ).toHaveValue('')
      await expect(
        window.locator('[data-testid="settings-endpoints-register-ssh-port"]'),
      ).toHaveValue('')

      const endpointCountAfter = await window.evaluate(async () => {
        const result = await window.opencoveApi.controlSurface.invoke<{ endpoints: unknown[] }>({
          kind: 'query',
          id: 'endpoint.list',
          payload: null,
        })
        return result.endpoints.length
      })
      expect(endpointCountAfter).toBe(endpointCountBefore)

      await testInfo.attach('ssh-config-prefilled-form', {
        body: await window
          .locator('[data-testid="settings-endpoints-register-window"]')
          .screenshot({ animations: 'disabled' }),
        contentType: 'image/png',
      })
    } finally {
      await electronApp.close().catch(() => undefined)
      await removePathWithRetry(userDataDir)
    }
  })
})
