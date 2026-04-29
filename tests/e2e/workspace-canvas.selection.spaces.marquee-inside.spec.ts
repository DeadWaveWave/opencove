import { expect, test } from '@playwright/test'
import {
  beginDragMouse,
  clearAndSeedWorkspace,
  launchApp,
  readCanvasViewport,
  readLocatorClientRect,
  testWorkspacePath,
} from './workspace-canvas.helpers'

test.describe('Workspace Canvas - Selection (Spaces)', () => {
  test('restricts inside-space marquee selection in mouse mode', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'mouse-marquee-inside-space-node',
            title: 'terminal-mouse-marquee-space',
            position: { x: 240, y: 200 },
            width: 460,
            height: 300,
          },
          {
            id: 'mouse-marquee-outside-space-node',
            title: 'terminal-mouse-marquee-outside',
            position: { x: 940, y: 200 },
            width: 460,
            height: 300,
          },
        ],
        {
          spaces: [
            {
              id: 'mouse-marquee-space',
              name: 'Mouse Space',
              directoryPath: testWorkspacePath,
              nodeIds: ['mouse-marquee-inside-space-node'],
              rect: { x: 200, y: 160, width: 540, height: 380 },
            },
          ],
          activeSpaceId: null,
          settings: {
            canvasInputMode: 'mouse',
          },
        },
      )

      const pane = window.locator('.workspace-canvas .react-flow__pane')
      await expect(pane).toBeVisible()

      const spaceRegion = window.locator('.workspace-space-region').first()
      await expect(spaceRegion).toBeVisible()

      const outsideNode = window
        .locator('.terminal-node')
        .filter({ hasText: 'terminal-mouse-marquee-outside' })
        .first()
      await expect(outsideNode).toBeVisible()

      const paneBox = await readLocatorClientRect(pane)
      const viewport = await readCanvasViewport(window)
      const toClientPoint = (point: { x: number; y: number }): { x: number; y: number } => ({
        x: paneBox.x + viewport.x + point.x * viewport.zoom,
        y: paneBox.y + viewport.y + point.y * viewport.zoom,
      })
      const start = toClientPoint({ x: 220, y: 180 })
      const end = toClientPoint({ x: 1308, y: 440 })

      const drag = await beginDragMouse(window, {
        start,
        initialTarget: end,
        steps: 12,
        modifiers: ['Shift'],
        draft: window.locator('.workspace-selection-draft'),
      })
      await drag.moveTo(end, { steps: 12, settleAfterMoveMs: 48 })

      await expect(window.locator('.react-flow__node.selected')).toHaveCount(1)
      await expect(
        window.locator('.react-flow__node.selected .terminal-node__title'),
      ).toContainText('terminal-mouse-marquee-space')

      await drag.release()

      await expect(window.locator('.react-flow__node.selected')).toHaveCount(1)
      await expect(
        window.locator('.react-flow__node.selected .terminal-node__title'),
      ).toContainText('terminal-mouse-marquee-space')
    } finally {
      await electronApp.close()
    }
  })

  test.skip('restricts marquee selection to start space contents', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'marquee-inside-space-node',
            title: 'terminal-marquee-space-node',
            position: { x: 240, y: 200 },
            width: 460,
            height: 300,
          },
          {
            id: 'marquee-outside-space-node',
            title: 'terminal-marquee-outside-node',
            position: { x: 940, y: 200 },
            width: 460,
            height: 300,
          },
        ],
        {
          spaces: [
            {
              id: 'marquee-start-space',
              name: 'Start Scope',
              directoryPath: testWorkspacePath,
              nodeIds: ['marquee-inside-space-node'],
              rect: { x: 200, y: 160, width: 540, height: 380 },
            },
          ],
          activeSpaceId: null,
          settings: {
            canvasInputMode: 'mouse',
          },
        },
      )

      const pane = window.locator('.workspace-canvas .react-flow__pane')
      await expect(pane).toBeVisible()

      const spaceRegion = window.locator('.workspace-space-region').first()
      await expect(spaceRegion).toBeVisible()

      const insideNodeTitle = window
        .locator('.terminal-node')
        .filter({ hasText: 'terminal-marquee-space-node' })
        .first()
      const outsideNodeTitle = window
        .locator('.terminal-node')
        .filter({ hasText: 'terminal-marquee-outside-node' })
        .first()
      await expect(insideNodeTitle).toBeVisible()
      await expect(outsideNodeTitle).toBeVisible()

      const paneBox = await readLocatorClientRect(pane)
      const viewport = await readCanvasViewport(window)
      const toClientPoint = (point: { x: number; y: number }): { x: number; y: number } => ({
        x: paneBox.x + viewport.x + point.x * viewport.zoom,
        y: paneBox.y + viewport.y + point.y * viewport.zoom,
      })
      const start = toClientPoint({ x: 220, y: 180 })
      const end = toClientPoint({ x: 1308, y: 440 })

      const drag = await beginDragMouse(window, {
        start,
        initialTarget: end,
        steps: 12,
        modifiers: ['Shift'],
        draft: window.locator('.workspace-selection-draft'),
      })
      await drag.moveTo(end, { steps: 12, settleAfterMoveMs: 48 })

      await expect(window.locator('.react-flow__node.selected')).toHaveCount(1)
      await expect(
        window.locator('.react-flow__node.selected .terminal-node__title'),
      ).toContainText('terminal-marquee-space-node')

      await drag.release()

      await expect(window.locator('.react-flow__node.selected')).toHaveCount(1)
      await expect(
        window.locator('.react-flow__node.selected .terminal-node__title'),
      ).toContainText('terminal-marquee-space-node')
    } finally {
      await electronApp.close()
    }
  })
})
