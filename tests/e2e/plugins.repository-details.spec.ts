import { expect, test } from '@playwright/test'
import { clearAndSeedWorkspace, launchApp } from './workspace-canvas.helpers'

test('reads community documentation before selecting a commit without activating an uninstalled package', async ({
  browserName: _browserName,
}, testInfo) => {
  const { electronApp, window: page } = await launchApp()
  try {
    // Isolate the external catalog transport. Host Git mutations remain real in maintenance.spec.
    await electronApp.evaluate(({ ipcMain }) => {
      const handlers = (
        ipcMain as unknown as {
          _invokeHandlers: Map<string, (event: unknown, request: unknown) => unknown>
        }
      )._invokeHandlers
      const channel = 'control-surface:invoke'
      const original = handlers.get(channel)
      if (!original) {
        throw new Error('Missing control-surface IPC handler')
      }
      ipcMain.removeHandler(channel)
      ipcMain.handle(channel, (event, request: { id?: string }) => {
        if (request.id === 'plugin.discover') {
          return {
            __opencoveIpcEnvelope: true,
            ok: true,
            value: {
              repositories: [
                {
                  name: 'community/desk-tool',
                  url: 'https://github.com/community/desk-tool',
                  description: 'A thoughtful workspace extension.',
                  stars: 20,
                },
              ],
            },
          }
        }
        if (request.id === 'plugin.repository.details') {
          return {
            __opencoveIpcEnvelope: true,
            ok: true,
            value: {
              repository: 'https://github.com/community/desk-tool',
              name: 'community/desk-tool',
              ref: 'main',
              commit: 'a'.repeat(40),
              description: 'A thoughtful workspace extension.',
              stars: 20,
              readme:
                '# Desk tool\n\nA quiet place for your workflow.\n\n## Features\n\n- Keyboard friendly\n- Follows your theme\n\n[Setup](docs/setup.md)\n\n![Preview](images/preview.svg)',
              readmePath: 'README.md',
              manifestError: null,
              manifest: {
                apiVersion: 1,
                id: 'desk-tool',
                version: '1.0.0',
                displayName: 'Desk tool',
                description: 'Workspace tool',
                view: { entry: 'index.html' },
                engines: { opencove: '>=0.3.2 <0.4.0' },
                platforms: ['darwin', 'linux', 'win32'],
              },
            },
          }
        }
        return original(event, request)
      })
    })

    await page.route('https://raw.githubusercontent.com/**', route =>
      route.fulfill({
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="560" height="180"><rect width="560" height="180" rx="12" fill="#12222e"/><rect x="24" y="24" width="260" height="130" rx="8" fill="#1a3546"/><text x="44" y="61" fill="#97e0ef" font-family="sans-serif" font-size="20">Workspace extension</text></svg>',
      }),
    )
    await page.setViewportSize({ width: 1300, height: 1000 })
    await clearAndSeedWorkspace(page, [], { settings: { language: 'en', uiTheme: 'pixel' } })
    await page.getByTestId('app-header-settings').click()
    await page.getByTestId('settings-section-nav-plugins').click()
    await page.getByTestId('settings-plugins-install').click()
    await page.getByRole('radio', { name: 'Discover', exact: true }).click()
    await page.getByTestId('settings-plugin-install-submit').click()
    await page.getByRole('button', { name: 'View details', exact: true }).click()
    const details = page.getByTestId('settings-plugin-repository-detail')
    await expect(
      details.getByRole('heading', { name: 'Desk tool', exact: true }).first(),
    ).toBeVisible()
    await expect(details.getByRole('link', { name: 'Setup', exact: true })).toHaveAttribute(
      'href',
      `https://github.com/community/desk-tool/blob/${'a'.repeat(40)}/docs/setup.md`,
    )
    const preview = details.getByRole('img', { name: 'Preview', exact: true })
    await preview.scrollIntoViewIfNeeded()
    await expect
      .poll(() => preview.evaluate(image => (image as HTMLImageElement).naturalWidth))
      .toBe(560)
    await expect(details.locator('iframe')).toHaveCount(0)
    await expect(page.getByTestId('settings-plugins-empty')).toBeVisible()
    const dark = testInfo.outputPath('plugin-repository-dark.png')
    await page.screenshot({ path: dark })
    await testInfo.attach('plugin-repository-dark', { path: dark, contentType: 'image/png' })
    await page.evaluate(() => {
      document.documentElement.dataset.coveTheme = 'light'
      document.documentElement.dataset.coveThemeId = 'pixel-light'
    })
    await page.setViewportSize({ width: 390, height: 900 })
    await details.scrollIntoViewIfNeeded()
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true)
    const light = testInfo.outputPath('plugin-repository-mobile-light.png')
    await page.screenshot({ path: light })
    await testInfo.attach('plugin-repository-mobile-light', {
      path: light,
      contentType: 'image/png',
    })
    await page.getByTestId('settings-plugin-repository-choose').click()
    await expect(page.getByTestId('settings-plugin-install-source')).toHaveValue(
      'https://github.com/community/desk-tool',
    )
    await page.getByText('Optional repository settings', { exact: true }).click()
    await expect(page.getByLabel('Branch, tag or commit', { exact: true })).toHaveValue(
      'a'.repeat(40),
    )
    await expect(page.getByTestId('settings-plugins-empty')).toBeVisible()
  } finally {
    await electronApp.close()
  }
})
