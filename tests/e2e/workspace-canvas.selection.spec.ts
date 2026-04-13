import { expect, test } from '@playwright/test'
import {
  clearAndSeedWorkspace,
  dragMouse,
  launchApp,
  readLocatorClientRect,
  storageKey,
} from './workspace-canvas.helpers'

test.describe('Workspace Canvas - Selection', () => {
  test('does not allow creating space from empty shift box selection', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(window, [])

      const pane = window.locator('.workspace-canvas .react-flow__pane')
      const paneBox = await readLocatorClientRect(pane)

      const startX = paneBox.x + 140
      const startY = paneBox.y + 120

      await dragMouse(window, {
        start: { x: startX, y: startY },
        end: { x: startX + 220, y: startY + 170 },
        steps: 8,
        modifiers: ['Shift'],
        draft: window.locator('.workspace-selection-draft'),
      })
      await expect(window.locator('.workspace-selection-draft')).toHaveCount(0)

      await expect(
        window.locator('[data-testid="workspace-empty-selection-create-space"]'),
      ).toHaveCount(0)
      await expect(window.locator('.workspace-space-switcher')).toHaveCount(0)

      const spaceCount = await window.evaluate(async key => {
        void key

        const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
        if (!raw) {
          return 0
        }

        const parsed = JSON.parse(raw) as {
          workspaces?: Array<{
            spaces?: unknown[]
          }>
        }

        return parsed.workspaces?.[0]?.spaces?.length ?? 0
      }, storageKey)

      expect(spaceCount).toBe(0)
    } finally {
      await electronApp.close()
    }
  })

  test('supports trackpad selection replace/toggle semantics', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'trackpad-select-node-a',
            title: 'terminal-trackpad-select-a',
            position: { x: 220, y: 180 },
            width: 460,
            height: 300,
          },
          {
            id: 'trackpad-select-node-b',
            title: 'terminal-trackpad-select-b',
            position: { x: 760, y: 220 },
            width: 460,
            height: 300,
          },
        ],
        {
          settings: {
            canvasInputMode: 'trackpad',
          },
        },
      )

      const pane = window.locator('.workspace-canvas .react-flow__pane')
      await expect(window.locator('.react-flow__node.selected')).toHaveCount(0)
      const paneBox = await readLocatorClientRect(pane)

      await dragMouse(window, {
        start: { x: paneBox.x + 120, y: paneBox.y + 120 },
        end: { x: paneBox.x + 700, y: paneBox.y + 520 },
      })

      await expect(window.locator('.react-flow__node.selected')).toHaveCount(1)
      await expect(
        window.locator('.react-flow__node.selected .terminal-node__title').first(),
      ).toContainText('terminal-trackpad-select-a')

      const secondNode = window
        .locator('.terminal-node')
        .filter({ hasText: 'terminal-trackpad-select-b' })
        .first()
      const secondNodeBox = await readLocatorClientRect(secondNode)

      const selectionStartX = Math.max(paneBox.x + 40, secondNodeBox.x - 24)
      const selectionStartY = Math.max(paneBox.y + 40, secondNodeBox.y - 24)
      const selectionEndX = Math.min(
        paneBox.x + paneBox.width - 40,
        secondNodeBox.x + secondNodeBox.width - 24,
      )
      const selectionEndY = Math.min(
        paneBox.y + paneBox.height - 120,
        secondNodeBox.y + secondNodeBox.height - 24,
      )

      await dragMouse(window, {
        start: { x: selectionStartX, y: selectionStartY },
        end: { x: selectionEndX, y: selectionEndY },
        steps: 10,
        modifiers: ['Shift'],
        draft: window.locator('.workspace-selection-draft'),
      })

      await expect(window.locator('.react-flow__node.selected')).toHaveCount(2)

      const firstNode = window
        .locator('.terminal-node')
        .filter({ hasText: 'terminal-trackpad-select-a' })
        .first()
      const firstNodeBoxForReplace = await readLocatorClientRect(firstNode)
      const replaceStartX = Math.max(paneBox.x + 40, firstNodeBoxForReplace.x - 24)
      const replaceStartY = Math.max(paneBox.y + 40, firstNodeBoxForReplace.y - 24)
      const replaceEndX = Math.min(
        paneBox.x + paneBox.width - 40,
        firstNodeBoxForReplace.x + firstNodeBoxForReplace.width - 24,
      )
      const replaceEndY = Math.min(
        paneBox.y + paneBox.height - 120,
        firstNodeBoxForReplace.y + firstNodeBoxForReplace.height - 24,
      )

      await dragMouse(window, {
        start: { x: replaceStartX, y: replaceStartY },
        end: { x: replaceEndX, y: replaceEndY },
        steps: 10,
        modifiers: ['Shift'],
        draft: window.locator('.workspace-selection-draft'),
      })

      await expect(window.locator('.react-flow__node.selected')).toHaveCount(1)
      await expect(
        window.locator('.react-flow__node.selected .terminal-node__title').first(),
      ).toContainText('terminal-trackpad-select-b')

      await dragMouse(window, {
        start: { x: replaceStartX, y: replaceStartY },
        end: { x: replaceEndX, y: replaceEndY },
        steps: 10,
        draft: window.locator('.workspace-selection-draft'),
      })

      await expect(window.locator('.react-flow__node.selected')).toHaveCount(1)
      await expect(
        window.locator('.react-flow__node.selected .terminal-node__title').first(),
      ).toContainText('terminal-trackpad-select-a')
    } finally {
      await electronApp.close()
    }
  })

  test('keeps selection while panning and clears selection on blank pane click', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'trackpad-pan-select-node',
            title: 'terminal-trackpad-pan-select',
            position: { x: 220, y: 180 },
            width: 460,
            height: 300,
          },
        ],
        {
          settings: {
            canvasInputMode: 'trackpad',
          },
        },
      )

      const pane = window.locator('.workspace-canvas .react-flow__pane')
      await expect(pane).toBeVisible()
      const paneBox = await readLocatorClientRect(pane)

      await dragMouse(window, {
        start: { x: paneBox.x + 120, y: paneBox.y + 120 },
        end: { x: paneBox.x + 700, y: paneBox.y + 520 },
      })
      await expect(window.locator('.react-flow__node.selected')).toHaveCount(1)

      await window.evaluate(() => {
        const paneElement = document.querySelector('.workspace-canvas .react-flow__pane')
        if (!(paneElement instanceof HTMLElement)) {
          return
        }

        paneElement.dispatchEvent(
          new WheelEvent('wheel', {
            deltaX: 140,
            deltaY: 40,
            deltaMode: 0,
            bubbles: true,
            cancelable: true,
          }),
        )
      })

      await expect(window.locator('.react-flow__node.selected')).toHaveCount(1)

      await pane.click({
        position: { x: 40, y: 40 },
      })

      await expect(window.locator('.react-flow__node.selected')).toHaveCount(0)
    } finally {
      await electronApp.close()
    }
  })

  test('does not select nodes on plain drag in mouse mode', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'mouse-select-node',
            title: 'terminal-mouse-select',
            position: { x: 220, y: 180 },
            width: 460,
            height: 300,
          },
        ],
        {
          settings: {
            canvasInputMode: 'mouse',
          },
        },
      )

      const pane = window.locator('.workspace-canvas .react-flow__pane')
      await expect(pane).toBeVisible()
      await expect(window.locator('.react-flow__node.selected')).toHaveCount(0)

      const paneBox = await readLocatorClientRect(pane)

      await dragMouse(window, {
        start: { x: paneBox.x + 80, y: paneBox.y + 80 },
        end: { x: paneBox.x + 760, y: paneBox.y + 560 },
      })
      await expect(window.locator('.react-flow__node.selected')).toHaveCount(0)
    } finally {
      await electronApp.close()
    }
  })
})
