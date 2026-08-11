import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { launchApp, removePathWithRetry } from './workspace-canvas.helpers'

test.describe('Add project wizard inline endpoint registration', () => {
  test('preserves the parent wizard across Escape, cancel, and successful registration', async ({
    browserName,
  }, testInfo) => {
    const userDataDir = await mkdtemp(
      path.join(tmpdir(), `opencove-e2e-inline-endpoint-${browserName}-`),
    )
    const draftProjectPath = path.join(userDataDir, 'draft-project')
    const { electronApp, window } = await launchApp({ userDataDir })

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

      await window.locator('[data-testid="workspace-sidebar-add-project"]').click()
      const wizard = window.locator('[data-testid="workspace-project-create-window"]')
      await expect(wizard).toBeVisible()
      await window
        .locator('[data-testid="workspace-project-create-default-local-root"]')
        .fill(draftProjectPath)
      await window
        .locator('[data-testid="workspace-project-create-default-location-remote"]')
        .click()

      const addEndpoint = window.locator('[data-testid="workspace-project-create-open-endpoints"]')
      await addEndpoint.click()
      const registration = window.locator('[data-testid="settings-endpoints-register-window"]')
      await expect(registration).toBeVisible()
      await testInfo.attach('inline-endpoint-registration', {
        body: await registration.screenshot({ animations: 'disabled' }),
        contentType: 'image/png',
      })

      await window.keyboard.press('Escape')
      await expect(registration).toHaveCount(0)
      await expect(wizard).toBeVisible()
      await expect(addEndpoint).toBeFocused()

      await addEndpoint.click()
      await window
        .locator('[data-testid="settings-endpoints-register-displayName"]')
        .fill('Inline build box')
      await window
        .locator('[data-testid="settings-endpoints-register-hostname"]')
        .fill('build.example.com')
      await window.locator('[data-testid="settings-endpoints-register-submit"]').click()

      await expect(registration).toHaveCount(0)
      await expect(wizard).toBeVisible()
      await expect(
        window.locator('[data-testid="workspace-project-create-default-remote-endpoint-trigger"]'),
      ).toContainText('Inline build box')

      await window
        .locator('[data-testid="workspace-project-create-default-location-local"]')
        .click()
      await expect(
        window.locator('[data-testid="workspace-project-create-default-local-root"]'),
      ).toHaveValue(draftProjectPath)

      const endpointNames = await window.evaluate(async () => {
        const result = await window.opencoveApi.controlSurface.invoke<{
          endpoints: Array<{ displayName: string }>
        }>({ kind: 'query', id: 'endpoint.list', payload: null })
        return result.endpoints.map(endpoint => endpoint.displayName)
      })
      expect(endpointNames.filter(name => name === 'Inline build box')).toHaveLength(1)
    } finally {
      await electronApp.close().catch(() => undefined)
      await removePathWithRetry(userDataDir)
    }
  })
})
