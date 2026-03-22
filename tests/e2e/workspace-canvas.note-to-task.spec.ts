import { expect, test } from '@playwright/test'
import { clearAndSeedWorkspace, launchApp } from './workspace-canvas.helpers'

test.describe('Workspace Canvas - Note to Task', () => {
  test('converts selected note to task via context menu', async () => {
    const { electronApp, window } = await launchApp()

    try {
      const noteText = '  Convert this note into a task.\\n\\n- [ ] menu item\\n'
      const expectedRequirement = noteText.trim()

      await clearAndSeedWorkspace(window, [
        {
          id: 'note-to-task',
          title: 'note',
          position: { x: 880, y: 420 },
          width: 420,
          height: 280,
          kind: 'note',
          task: {
            text: noteText,
          },
        },
      ])

      const noteNode = window.locator('.note-node').first()
      await expect(noteNode).toBeVisible()

      const minimapDock = window.locator('.workspace-canvas__minimap-dock')
      await expect(minimapDock).toBeVisible()
      await minimapDock.hover()
      const minimapToggle = window.locator('[data-testid="workspace-minimap-toggle"]')
      await expect(minimapToggle).toBeVisible()
      await minimapToggle.click()
      await expect(window.locator('.workspace-canvas__minimap')).toHaveCount(0)

      const noteHeader = noteNode.locator('.note-node__header')
      await expect(noteHeader).toBeVisible()
      await noteHeader.click({ position: { x: 40, y: 20 } })
      await expect(window.locator('.react-flow__node.selected')).toHaveCount(1)

      await noteNode.click({ button: 'right', position: { x: 60, y: 16 } })
      const convertButton = window.locator(
        '[data-testid="workspace-selection-convert-note-to-task"]',
      )
      await expect(convertButton).toBeVisible()
      await expect(convertButton).toBeEnabled()

      await convertButton.click()

      await expect(window.locator('.workspace-context-menu')).toHaveCount(0)
      await expect(window.locator('.note-node')).toHaveCount(0)

      const taskNode = window.locator('.task-node').first()
      await expect(taskNode).toBeVisible()
      const requirementInput = taskNode.locator(
        '[data-testid="task-node-inline-requirement-input"]',
      )
      await expect(requirementInput).toHaveValue(expectedRequirement)
    } finally {
      await electronApp.close()
    }
  })

  test('dismisses context menu when clicking note textarea', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(window, [
        {
          id: 'note-to-task-menu-dismiss',
          title: 'note',
          position: { x: 880, y: 420 },
          width: 420,
          height: 280,
          kind: 'note',
          task: {
            text: 'Dismiss menu on input click.',
          },
        },
      ])

      // Keep the interactive minimap overlay from stealing the note click in smaller/offscreen windows.
      const minimapDock = window.locator('.workspace-canvas__minimap-dock')
      await expect(minimapDock).toBeVisible()
      await minimapDock.hover()
      const minimapToggle = window.locator('[data-testid="workspace-minimap-toggle"]')
      await expect(minimapToggle).toBeVisible()
      await minimapToggle.click()
      await expect(window.locator('.workspace-canvas__minimap')).toHaveCount(0)

      const noteNode = window.locator('.note-node').first()
      await expect(noteNode).toBeVisible()

      const noteHeader = noteNode.locator('.note-node__header')
      await expect(noteHeader).toBeVisible()
      await noteHeader.click({ position: { x: 40, y: 20 } })
      await expect(window.locator('.react-flow__node.selected')).toHaveCount(1)

      await noteNode.click({ button: 'right', position: { x: 60, y: 16 } })
      await expect(window.locator('.workspace-context-menu')).toHaveCount(1)

      await noteNode.click({ position: { x: 48, y: 64 } })
      await expect(window.locator('.workspace-context-menu')).toHaveCount(0)
    } finally {
      await electronApp.close()
    }
  })
})
