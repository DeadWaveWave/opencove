import { expect, test } from '@playwright/test'
import { launchApp, seedWorkspaceState, testWorkspacePath } from './workspace-canvas.helpers'

const commandCenterModifier = process.platform === 'darwin' ? 'Meta' : 'Control'

test.describe('Command Center', () => {
  test('opens and closes via keyboard shortcuts', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await seedWorkspaceState(window, {
        activeWorkspaceId: 'workspace-command-center-a',
        workspaces: [
          {
            id: 'workspace-command-center-a',
            name: 'workspace-command-center-a',
            path: testWorkspacePath,
            nodes: [],
          },
        ],
      })

      const commandCenter = window.locator('[data-testid="command-center"]')
      const commandCenterInput = window.locator('[data-testid="command-center-input"]')

      await window.keyboard.press(`${commandCenterModifier}+K`)
      await expect(commandCenter).toBeVisible()
      await expect(commandCenterInput).toBeFocused()

      await window.keyboard.press('Escape')
      await expect(commandCenter).toBeHidden()

      await window.keyboard.press(`${commandCenterModifier}+P`)
      await expect(commandCenter).toBeVisible()

      await window.keyboard.press(`${commandCenterModifier}+P`)
      await expect(commandCenter).toBeHidden()
    } finally {
      await electronApp.close()
    }
  })

  test('switches projects via search', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await seedWorkspaceState(window, {
        activeWorkspaceId: 'workspace-command-center-a',
        workspaces: [
          {
            id: 'workspace-command-center-a',
            name: 'workspace-command-center-a',
            path: testWorkspacePath,
            nodes: [],
          },
          {
            id: 'workspace-command-center-b',
            name: 'workspace-command-center-b',
            path: testWorkspacePath,
            nodes: [],
          },
        ],
      })

      const commandCenterButton = window.locator('[data-testid="app-header-command-center"]')
      await expect(commandCenterButton).toBeVisible()
      await expect(commandCenterButton).toContainText('workspace-command-center-a')

      await window.keyboard.press(`${commandCenterModifier}+K`)
      const commandCenterInput = window.locator('[data-testid="command-center-input"]')
      await expect(commandCenterInput).toBeFocused()

      await commandCenterInput.fill('workspace-command-center-b')
      await window.keyboard.press('Enter')

      await expect(window.locator('[data-testid="command-center"]')).toBeHidden()
      await expect(commandCenterButton).toContainText('workspace-command-center-b')
    } finally {
      await electronApp.close()
    }
  })
})
