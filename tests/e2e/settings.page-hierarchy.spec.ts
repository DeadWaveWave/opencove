/* eslint-disable no-await-in-loop -- Settings pages share one panel and are visited in turn. */
import { expect, test } from '@playwright/test'
import { clearAndSeedWorkspace, launchApp } from './workspace-canvas.helpers'

const SETTINGS_PAGES = [
  'settings-section-nav-general',
  'settings-section-nav-appearance',
  'settings-section-nav-canvas',
  'settings-section-nav-agent',
  'settings-section-nav-terminal',
  'settings-section-nav-shortcuts',
  'settings-section-nav-worker',
  'settings-section-nav-experimental',
] as const

test.describe('Settings - page hierarchy', () => {
  test('no group repeats its page title and routine actions use the quiet button', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(window, [])
      await window.getByTestId('app-header-settings').click()
      const panel = window.getByTestId('settings-panel')
      await expect(panel).toBeVisible()

      for (const navTestId of SETTINGS_PAGES) {
        await panel.getByTestId(navTestId).click()
        const title = (await panel.getByTestId('settings-panel-title').textContent())?.trim()
        expect(title, navTestId).toBeTruthy()
        const groupTitles = await panel
          .locator('.settings-panel__group-title')
          .evaluateAll(headings => headings.map(heading => heading.textContent?.trim()))
        expect(groupTitles, `${navTestId} groups`).not.toContain(title)
        // A settings page is a list of preferences, not a form with one decisive action: adding,
        // saving a field or opening something is a neutral button. The accent fill is kept for a
        // dialog's confirm and for an update waiting to install.
        await expect(panel.locator('.cove-button--primary:visible'), navTestId).toHaveCount(0)
      }
    } finally {
      await electronApp.close()
    }
  })
})
