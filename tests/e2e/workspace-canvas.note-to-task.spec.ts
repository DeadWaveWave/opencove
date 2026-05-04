import { expect, test } from '@playwright/test'
import { resolveDefaultTaskWindowSize } from '../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/constants'
import {
  clearAndSeedWorkspace,
  clickHeaderDragSurface,
  launchApp,
} from './workspace-canvas.helpers'
import { readSeededWorkspaceLayout, rectsOverlap } from './workspace-canvas.arrange.shared'

test.describe('Workspace Canvas - Note to Task', () => {
  test.skip('converts selected note to task via context menu', async () => {
    const { electronApp, window } = await launchApp()

    try {
      const noteText = '  Convert this note into a task.\\n\\n- [ ] menu item\\n'
      const expectedRequirement = noteText.trim()
      const sourcePosition = { x: 880, y: 420 }
      const sourceNoteSize = { width: 220, height: 140 }
      const blockerInitialY = 580
      const expectedTaskSize = resolveDefaultTaskWindowSize('regular')

      await clearAndSeedWorkspace(window, [
        {
          id: 'note-to-task',
          title: 'note',
          position: sourcePosition,
          width: sourceNoteSize.width,
          height: sourceNoteSize.height,
          kind: 'note',
          task: {
            text: noteText,
          },
        },
        {
          id: 'note-to-task-blocker',
          title: 'blocker',
          position: { x: 880, y: blockerInitialY },
          width: 460,
          height: 300,
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
      await clickHeaderDragSurface(noteHeader)
      await expect(window.locator('.react-flow__node.selected')).toHaveCount(1)

      await noteNode.click({ button: 'right', position: { x: 60, y: 16 } })
      const selectionMenu = window.locator('.workspace-context-menu').first()
      const menuIds = await selectionMenu
        .locator('button')
        .evaluateAll(buttons => buttons.map(button => button.getAttribute('data-testid')))
      expect(menuIds.slice(0, 3)).toEqual([
        'workspace-selection-create-space',
        'workspace-selection-convert-note-to-task',
        'workspace-selection-label-color',
      ])

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
      await expect
        .poll(async () => {
          const layout = await readSeededWorkspaceLayout(window, {
            nodeIds: ['note-to-task', 'note-to-task-blocker'],
            spaceIds: [],
          })
          const converted = layout.nodes['note-to-task']
          const blocker = layout.nodes['note-to-task-blocker']

          if (!converted || !blocker) {
            return false
          }

          return (
            converted.x === sourcePosition.x &&
            converted.y === sourcePosition.y &&
            converted.width === expectedTaskSize.width &&
            converted.height === expectedTaskSize.height &&
            blocker.x === 880 &&
            blocker.width === 460 &&
            blocker.height === 300 &&
            blocker.y > blockerInitialY &&
            rectsOverlap(converted, blocker) === false
          )
        })
        .toBe(true)

      const layout = await readSeededWorkspaceLayout(window, {
        nodeIds: ['note-to-task', 'note-to-task-blocker'],
        spaceIds: [],
      })
      const blocker = layout.nodes['note-to-task-blocker']
      expect(blocker).toBeTruthy()
      expect((blocker?.y ?? 0) > blockerInitialY).toBe(true)
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
      await clickHeaderDragSurface(noteHeader)
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
