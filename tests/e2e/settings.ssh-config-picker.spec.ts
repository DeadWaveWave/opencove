/* eslint-disable no-await-in-loop -- Theme and mode captures reuse one Electron window sequentially. */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { openSettings, switchSettingsPage } from './m6.endpoints-mounts.integration.helpers'
import { clearAndSeedWorkspace, launchApp, removePathWithRetry } from './workspace-canvas.helpers'

test.describe('Settings SSH config host picker', () => {
  test('keeps remote registration usable in both Pixel themes and narrow windows', async ({
    browserName: _browserName,
  }, testInfo) => {
    const { electronApp, window } = await launchApp()
    try {
      for (const configuration of [
        { uiTheme: 'pixel', language: 'zh-CN' },
        { uiTheme: 'pixel-light', language: 'en' },
      ] as const) {
        await electronApp.evaluate(({ BrowserWindow }) => {
          BrowserWindow.getAllWindows()[0].setContentSize(1200, 800, false)
        })
        await clearAndSeedWorkspace(window, [], { settings: configuration })
        await expect(window.locator('html')).toHaveAttribute(
          'data-cove-theme-id',
          configuration.uiTheme,
        )
        await openSettings(window)
        await switchSettingsPage(window, 'endpoints')
        const before = await window.evaluate(
          async () =>
            (
              await window.opencoveApi.controlSurface.invoke<{ endpoints: unknown[] }>({
                kind: 'query',
                id: 'endpoint.list',
                payload: null,
              })
            ).endpoints.length,
        )
        for (const width of [1200, 720]) {
          await electronApp.evaluate(({ BrowserWindow }, size) => {
            BrowserWindow.getAllWindows()[0].setContentSize(size, 800, false)
          }, width)
          await expect.poll(() => window.evaluate(() => window.innerWidth)).toBe(width)
          await window.getByTestId('settings-endpoints-open-register').click()
          const form = window.getByTestId('settings-endpoints-register-window')
          await expect(form).toBeVisible()
          for (const mode of ['managed', 'manual'] as const) {
            const modeButton = form.getByTestId(`settings-endpoints-register-mode-${mode}`)
            await modeButton.click()
            await expect(modeButton).toBeChecked()
            await expect(
              form.getByTestId(
                `settings-endpoints-register-mode-${mode === 'managed' ? 'manual' : 'managed'}`,
              ),
            ).not.toBeChecked()
            const host = form.getByTestId(
              `settings-endpoints-register-${mode === 'managed' ? 'hostname' : 'manual-hostname'}`,
            )
            await expect(host).toHaveAccessibleName(/\S/)
            await host.fill('dev.example.test')
            if (mode === 'managed') {
              const importButton = form.getByTestId('settings-endpoints-ssh-config-open')
              await expect(importButton).toBeEnabled()
              await expect(importButton).toHaveClass(/cove-button--secondary/)
            } else {
              await expect(form.getByTestId('settings-endpoints-register-token')).toBeVisible()
            }
            const dimensions = await form.evaluate(element => ({
              visible: element.clientWidth,
              scroll: element.scrollWidth,
            }))
            expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.visible + 1)
            await expect(form.getByTestId('settings-endpoints-register-cancel')).toBeInViewport()
            const name = `remote-registration-${configuration.uiTheme}-${width}-${mode}`
            const screenshotPath = testInfo.outputPath(`${name}.png`)
            await form.screenshot({ path: screenshotPath, animations: 'disabled' })
            await testInfo.attach(name, { path: screenshotPath, contentType: 'image/png' })
          }
          await form.getByTestId('settings-endpoints-register-cancel').click()
          await expect(form).toHaveCount(0)
        }
        const after = await window.evaluate(
          async () =>
            (
              await window.opencoveApi.controlSurface.invoke<{ endpoints: unknown[] }>({
                kind: 'query',
                id: 'endpoint.list',
                payload: null,
              })
            ).endpoints.length,
        )
        expect(after).toBe(before)
        await window.keyboard.press('Escape')
      }
    } finally {
      await electronApp.close()
    }
  })

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

      const screenshotPath = testInfo.outputPath('ssh-config-prefilled-form.png')
      await window
        .getByTestId('settings-endpoints-register-window')
        .screenshot({ path: screenshotPath, animations: 'disabled' })
      await testInfo.attach('ssh-config-prefilled-form', {
        path: screenshotPath,
        contentType: 'image/png',
      })
    } finally {
      await electronApp.close().catch(() => undefined)
      await removePathWithRetry(userDataDir)
    }
  })
})
