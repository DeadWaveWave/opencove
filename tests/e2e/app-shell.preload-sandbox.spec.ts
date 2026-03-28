import { expect, test } from '@playwright/test'
import { launchApp } from './workspace-canvas.helpers'

test.describe('App Shell - Sandboxed Preload', () => {
  test('renders the shell when the renderer sandbox is enabled', async () => {
    const { electronApp, window } = await launchApp({
      windowMode: 'offscreen',
      env: {
        OPENCOVE_E2E_FORCE_RENDERER_SANDBOX: '1',
      },
    })

    try {
      await expect(
        window.locator('[data-testid="app-header-toggle-primary-sidebar"]'),
      ).toBeVisible()
      await expect(window.locator('[data-testid="app-header-settings"]')).toBeVisible()
      await expect(window.locator('.workspace-main')).toBeVisible()
    } finally {
      await electronApp.close()
    }
  })
})
