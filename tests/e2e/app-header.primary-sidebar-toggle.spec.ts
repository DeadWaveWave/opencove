import { expect, test } from '@playwright/test'
import { launchApp, seedWorkspaceState, testWorkspacePath } from './workspace-canvas.helpers'

test.describe('App Header - Primary Sidebar Toggle', () => {
  test('toggles the sidebar visibility', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await seedWorkspaceState(window, {
        activeWorkspaceId: 'workspace-toggle-a',
        workspaces: [
          {
            id: 'workspace-toggle-a',
            name: 'workspace-toggle-a',
            path: testWorkspacePath,
            nodes: [],
          },
        ],
      })

      const sidebar = window.locator('.workspace-sidebar')
      const toggleButton = window.locator('[data-testid="app-header-toggle-primary-sidebar"]')
      const settingsButton = window.locator('[data-testid="app-header-settings"]')

      await expect(toggleButton).toBeVisible()
      await expect(settingsButton).toBeVisible()
      await expect(sidebar).toBeVisible()

      await toggleButton.click()
      await expect(sidebar).toBeHidden()
      await expect(settingsButton).toBeVisible()

      await toggleButton.click()
      await expect(sidebar).toBeVisible()
    } finally {
      await electronApp.close()
    }
  })

  test('respects persisted collapsed state on load', async () => {
    const { electronApp, window } = await launchApp()

    try {
      const writeResult = await window.evaluate(
        async state => {
          return await window.opencoveApi.persistence.writeWorkspaceStateRaw({
            raw: JSON.stringify(state),
          })
        },
        {
          formatVersion: 1,
          activeWorkspaceId: 'workspace-toggle-b',
          workspaces: [
            {
              id: 'workspace-toggle-b',
              name: 'workspace-toggle-b',
              path: testWorkspacePath,
              nodes: [],
            },
          ],
          settings: {
            isPrimarySidebarCollapsed: true,
          },
        },
      )

      if (!writeResult.ok) {
        throw new Error(
          `Failed to seed workspace state: ${writeResult.reason}: ${writeResult.error.code}${
            writeResult.error.debugMessage ? `: ${writeResult.error.debugMessage}` : ''
          }`,
        )
      }

      await window.reload({ waitUntil: 'domcontentloaded' })

      const sidebar = window.locator('.workspace-sidebar')
      const toggleButton = window.locator('[data-testid="app-header-toggle-primary-sidebar"]')

      await expect(toggleButton).toBeVisible()
      await expect(window.locator('.app-shell--sidebar-collapsed')).toHaveCount(1)
      await expect(sidebar).toBeHidden()

      await toggleButton.click()
      await expect(sidebar).toBeVisible()
    } finally {
      await electronApp.close()
    }
  })
})
