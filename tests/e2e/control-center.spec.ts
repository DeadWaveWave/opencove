import { expect, test } from '@playwright/test'
import { launchApp, seedWorkspaceState, testWorkspacePath } from './workspace-canvas.helpers'

test.describe('Control Center', () => {
  test('opens and toggles theme, sidebar, minimap', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await seedWorkspaceState(window, {
        activeWorkspaceId: 'workspace-control-center',
        workspaces: [
          {
            id: 'workspace-control-center',
            name: 'workspace-control-center',
            path: testWorkspacePath,
            nodes: [],
          },
        ],
        settings: {
          uiTheme: 'dark',
          isPrimarySidebarCollapsed: false,
        },
      })

      const pane = window.locator('.workspace-canvas .react-flow__pane')
      await expect(pane).toBeVisible()

      const controlCenterButton = window.locator('[data-testid="app-header-control-center"]')
      await expect(controlCenterButton).toBeVisible()
      await controlCenterButton.click()

      await expect(window.locator('[data-testid="control-center"]')).toBeVisible()

      await window.locator('[data-testid="control-center-theme-light"]').click()
      await expect(window.locator('html')).toHaveAttribute('data-cove-theme', 'light')

      const sidebar = window.locator('.workspace-sidebar')
      await expect(sidebar).toBeVisible()
      await window.locator('[data-testid="control-center-toggle-sidebar"]').click()
      await expect(sidebar).toBeHidden()

      const minimap = window.locator('.workspace-canvas__minimap')
      const wasMinimapVisible = (await minimap.count()) > 0
      await window.locator('[data-testid="control-center-toggle-minimap"]').click()
      await expect(minimap).toHaveCount(wasMinimapVisible ? 0 : 1)
    } finally {
      await electronApp.close()
    }
  })

  test('opens settings from Control Center', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await seedWorkspaceState(window, {
        activeWorkspaceId: 'workspace-control-center-settings',
        workspaces: [
          {
            id: 'workspace-control-center-settings',
            name: 'workspace-control-center-settings',
            path: testWorkspacePath,
            nodes: [],
          },
        ],
      })

      const controlCenterButton = window.locator('[data-testid="app-header-control-center"]')
      await expect(controlCenterButton).toBeVisible()
      await controlCenterButton.click()

      await expect(window.locator('[data-testid="control-center"]')).toBeVisible()
      await window.locator('[data-testid="control-center-open-settings"]').click()

      await expect(window.locator('.settings-panel')).toBeVisible()
      await expect(window.locator('[data-testid="control-center"]')).toHaveCount(0)
    } finally {
      await electronApp.close()
    }
  })
})
