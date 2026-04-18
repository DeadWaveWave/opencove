import { expect, test } from '@playwright/test'
import {
  clearAndSeedWorkspace,
  dragMouse,
  launchApp,
  readLocatorClientRect,
  testWorkspacePath,
} from './workspace-canvas.helpers'

test.describe('Workspace Canvas - Selection (Node Scope)', () => {
  test('does not allow shift-click multi-select across space boundaries', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'node-scope-inside',
            title: 'terminal-scope-inside',
            position: { x: 220, y: 180 },
            width: 360,
            height: 240,
          },
          {
            id: 'node-scope-outside',
            title: 'terminal-scope-outside',
            position: { x: 820, y: 180 },
            width: 360,
            height: 240,
          },
        ],
        {
          spaces: [
            {
              id: 'scope-space-a',
              name: 'Scope Space A',
              directoryPath: testWorkspacePath,
              nodeIds: ['node-scope-inside'],
              rect: { x: 200, y: 160, width: 540, height: 380 },
            },
          ],
          activeSpaceId: null,
          settings: {
            canvasInputMode: 'mouse',
          },
        },
      )

      const insideNode = window
        .locator('.react-flow__node')
        .filter({ hasText: 'terminal-scope-inside' })
        .first()
      const outsideNode = window
        .locator('.react-flow__node')
        .filter({ hasText: 'terminal-scope-outside' })
        .first()

      const insideHeader = insideNode.locator('.terminal-node__header')
      const outsideHeader = outsideNode.locator('.terminal-node__header')
      await expect(insideHeader).toBeVisible()
      await expect(outsideHeader).toBeVisible()

      await insideHeader.click({ position: { x: 40, y: 20 } })
      await expect(window.locator('.react-flow__node.selected')).toHaveCount(1)

      await window.keyboard.down('Shift')
      await outsideHeader.click({ position: { x: 40, y: 20 } })
      await window.keyboard.up('Shift')

      await expect(window.locator('.react-flow__node.selected')).toHaveCount(1)
      await expect(
        window.locator('.react-flow__node.selected .terminal-node__title').first(),
      ).toContainText('terminal-scope-outside')
    } finally {
      await electronApp.close()
    }
  })

  test('does not allow shift marquee multi-select across space boundaries', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'node-scope-marquee-inside',
            title: 'terminal-scope-marquee-inside',
            position: { x: 220, y: 180 },
            width: 360,
            height: 240,
          },
          {
            id: 'node-scope-marquee-outside',
            title: 'terminal-scope-marquee-outside',
            position: { x: 820, y: 180 },
            width: 360,
            height: 240,
          },
        ],
        {
          spaces: [
            {
              id: 'scope-marquee-space-a',
              name: 'Scope Marquee Space A',
              directoryPath: testWorkspacePath,
              nodeIds: ['node-scope-marquee-inside'],
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

      const insideNode = window
        .locator('.react-flow__node')
        .filter({ hasText: 'terminal-scope-marquee-inside' })
        .first()
      const outsideNode = window
        .locator('.react-flow__node')
        .filter({ hasText: 'terminal-scope-marquee-outside' })
        .first()

      const insideHeader = insideNode.locator('.terminal-node__header')
      await expect(insideHeader).toBeVisible()
      await expect(outsideNode).toBeVisible()

      await insideHeader.click({ position: { x: 40, y: 20 } })
      await expect(window.locator('.react-flow__node.selected')).toHaveCount(1)

      const paneBox = await readLocatorClientRect(pane)
      const outsideBox = await readLocatorClientRect(outsideNode)

      const startX = Math.max(paneBox.x + 40, outsideBox.x - 24)
      const startY = Math.max(paneBox.y + 40, outsideBox.y - 24)
      const endX = Math.min(paneBox.x + paneBox.width - 40, outsideBox.x + outsideBox.width - 24)
      const endY = Math.min(paneBox.y + paneBox.height - 40, outsideBox.y + outsideBox.height - 24)

      await dragMouse(window, {
        start: { x: startX, y: startY },
        end: { x: endX, y: endY },
        steps: 10,
        modifiers: ['Shift'],
        draft: window.locator('.workspace-selection-draft'),
      })

      await expect(window.locator('.workspace-selection-draft')).toHaveCount(0)
      await expect(window.locator('.react-flow__node.selected')).toHaveCount(1)
      await expect(
        window.locator('.react-flow__node.selected .terminal-node__title').first(),
      ).toContainText('terminal-scope-marquee-outside')
    } finally {
      await electronApp.close()
    }
  })
})
