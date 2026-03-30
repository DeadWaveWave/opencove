import { expect, test } from '@playwright/test'
import {
  dragLocatorTo,
  launchApp,
  seedWorkspaceState,
  testWorkspacePath,
} from './workspace-canvas.helpers'

test.describe('Workspace Canvas - Sidebar Drag Reorder', () => {
  test('reorders workspaces by dragging and persists the new order', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await seedWorkspaceState(window, {
        activeWorkspaceId: 'workspace-drag-a',
        workspaces: [
          {
            id: 'workspace-drag-a',
            name: 'Project Alpha',
            path: testWorkspacePath,
            nodes: [],
          },
          {
            id: 'workspace-drag-b',
            name: 'Project Beta',
            path: `${testWorkspacePath}-b`,
            nodes: [],
          },
          {
            id: 'workspace-drag-c',
            name: 'Project Gamma',
            path: `${testWorkspacePath}-c`,
            nodes: [],
          },
        ],
      })

      const workspaceNames = window.locator('.workspace-item__name')
      await expect(workspaceNames).toHaveCount(3)
      await expect(workspaceNames.nth(0)).toHaveText('Project Alpha')
      await expect(workspaceNames.nth(1)).toHaveText('Project Beta')
      await expect(workspaceNames.nth(2)).toHaveText('Project Gamma')

      // Drag "Project Alpha" (first) down to "Project Gamma" (third) position
      const firstItem = window
        .locator('.workspace-item')
        .filter({ hasText: 'Project Alpha' })
        .first()
      const thirdItem = window
        .locator('.workspace-item')
        .filter({ hasText: 'Project Gamma' })
        .first()

      await dragLocatorTo(window, firstItem, thirdItem)

      // Verify new order in DOM — Alpha should have moved down
      await expect
        .poll(
          async () => {
            const names = await workspaceNames.allTextContents()
            return names
          },
          { timeout: 5_000 },
        )
        .toEqual(['Project Beta', 'Project Gamma', 'Project Alpha'])

      // Verify persistence — reload and check order is maintained
      await expect
        .poll(
          async () => {
            const raw = await window.evaluate(async () => {
              return await window.opencoveApi.persistence.readWorkspaceStateRaw()
            })
            if (!raw) {
              return null
            }

            const parsed = JSON.parse(raw) as {
              workspaces?: Array<{ name?: string }>
            }

            return (parsed.workspaces ?? []).map(workspace => workspace.name)
          },
          { timeout: 10_000 },
        )
        .toEqual(['Project Beta', 'Project Gamma', 'Project Alpha'])
    } finally {
      await electronApp.close()
    }
  })

  test('click still selects workspace after drag setup', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await seedWorkspaceState(window, {
        activeWorkspaceId: 'workspace-click-a',
        workspaces: [
          {
            id: 'workspace-click-a',
            name: 'Click Alpha',
            path: testWorkspacePath,
            nodes: [],
          },
          {
            id: 'workspace-click-b',
            name: 'Click Beta',
            path: `${testWorkspacePath}-b`,
            nodes: [],
          },
        ],
      })

      const activeItem = window.locator('.workspace-item.workspace-item--active')
      await expect(activeItem).toContainText('Click Alpha')

      // Click the second workspace — should select it, not start a drag
      const secondItem = window.locator('.workspace-item').filter({ hasText: 'Click Beta' }).first()
      await secondItem.click()

      await expect(activeItem).toContainText('Click Beta')
    } finally {
      await electronApp.close()
    }
  })

  test('right-click context menu still works on sortable items', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await seedWorkspaceState(window, {
        activeWorkspaceId: 'workspace-ctx-a',
        workspaces: [
          {
            id: 'workspace-ctx-a',
            name: 'Context Alpha',
            path: testWorkspacePath,
            nodes: [],
          },
          {
            id: 'workspace-ctx-b',
            name: 'Context Beta',
            path: `${testWorkspacePath}-b`,
            nodes: [],
          },
        ],
      })

      const secondItem = window
        .locator('.workspace-item')
        .filter({ hasText: 'Context Beta' })
        .first()
      await expect(secondItem).toBeVisible()

      await secondItem.click({ button: 'right' })

      const removeButton = window.locator(
        '[data-testid="workspace-project-remove-workspace-ctx-b"]',
      )
      await expect(removeButton).toBeVisible()
    } finally {
      await electronApp.close()
    }
  })
})
