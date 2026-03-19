import { expect, test, type Page } from '@playwright/test'
import {
  clearAndSeedWorkspace,
  dragMouse,
  launchApp,
  readCanvasViewport,
  storageKey,
} from './workspace-canvas.helpers'

test.describe('Workspace Canvas - Selection (Terminal Multi Drag)', () => {
  const readNodePositions = async (
    window: Page,
  ): Promise<{ left: { x: number; y: number }; right: { x: number; y: number } } | null> => {
    return await window.evaluate(async key => {
      void key

      const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
      if (!raw) {
        return null
      }

      const state = JSON.parse(raw) as {
        workspaces?: Array<{
          nodes?: Array<{
            id?: string
            position?: { x?: number; y?: number }
          }>
        }>
      }

      const nodes = state.workspaces?.[0]?.nodes ?? []
      const leftNode = nodes.find(entry => entry.id === 'terminal-multi-left')
      const rightNode = nodes.find(entry => entry.id === 'terminal-multi-right')

      if (
        !leftNode?.position ||
        typeof leftNode.position.x !== 'number' ||
        typeof leftNode.position.y !== 'number' ||
        !rightNode?.position ||
        typeof rightNode.position.x !== 'number' ||
        typeof rightNode.position.y !== 'number'
      ) {
        return null
      }

      return {
        left: { x: leftNode.position.x, y: leftNode.position.y },
        right: { x: rightNode.position.x, y: rightNode.position.y },
      }
    }, storageKey)
  }

  test('drags multi-selected terminals after shift-click selection', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'terminal-multi-left',
            title: 'terminal-multi-drag-left',
            position: { x: 220, y: 180 },
            width: 460,
            height: 300,
          },
          {
            id: 'terminal-multi-right',
            title: 'terminal-multi-drag-right',
            position: { x: 760, y: 180 },
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

      const leftTerminal = window
        .locator('.terminal-node')
        .filter({ hasText: 'terminal-multi-drag-left' })
        .first()
      const rightTerminal = window
        .locator('.terminal-node')
        .filter({ hasText: 'terminal-multi-drag-right' })
        .first()
      await expect(leftTerminal).toBeVisible()
      await expect(rightTerminal).toBeVisible()

      const leftHeader = leftTerminal.locator('.terminal-node__header')
      const rightHeader = rightTerminal.locator('.terminal-node__header')

      await leftHeader.click({ position: { x: 40, y: 20 } })
      await rightHeader.click({ position: { x: 40, y: 20 }, modifiers: ['Shift'] })

      await expect(window.locator('.react-flow__node.selected')).toHaveCount(2)
      await expect(window.locator('.react-flow__nodesselection-rect')).toHaveCount(1)
      await expect(rightHeader).toBeVisible()

      const before = await readNodePositions(window)
      if (!before) {
        throw new Error('node positions unavailable before multi-drag')
      }

      await readCanvasViewport(window)

      const pane = window.locator('.workspace-canvas .react-flow__pane')
      await expect(pane).toBeVisible()
      const paneBox = await pane.boundingBox()
      const headerBox = await rightHeader.boundingBox()
      if (!paneBox || !headerBox) {
        throw new Error('header/pane bounding box unavailable for multi-drag')
      }

      const startX = Math.min(paneBox.x + paneBox.width - 40, headerBox.x + 140)
      const startY = headerBox.y + 20
      const endX = Math.min(paneBox.x + paneBox.width - 60, startX + 240)
      const endY = Math.min(paneBox.y + paneBox.height - 60, startY + 220)

      await window.waitForTimeout(150)

      await dragMouse(window, {
        start: { x: startX, y: startY },
        end: { x: endX, y: endY },
        steps: 12,
      })

      await readCanvasViewport(window)
      await leftTerminal.boundingBox()
      await rightTerminal.boundingBox()

      await expect
        .poll(async () => {
          const after = await readNodePositions(window)
          if (!after) {
            return Number.NaN
          }

          return Math.hypot(after.right.x - before.right.x, after.right.y - before.right.y)
        })
        .toBeGreaterThan(120)

      await expect
        .poll(async () => {
          const after = await readNodePositions(window)
          if (!after) {
            return Number.NaN
          }

          return Math.hypot(after.left.x - before.left.x, after.left.y - before.left.y)
        })
        .toBeGreaterThan(120)
    } finally {
      await electronApp.close()
    }
  })

  test('drags multi-selected terminals after sequential shift marquee selection', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'terminal-multi-left',
            title: 'terminal-multi-marquee-left',
            position: { x: 220, y: 180 },
            width: 460,
            height: 300,
          },
          {
            id: 'terminal-multi-right',
            title: 'terminal-multi-marquee-right',
            position: { x: 760, y: 180 },
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
      const paneBox = await pane.boundingBox()
      if (!paneBox) {
        throw new Error('workspace pane bounding box unavailable for marquee selection')
      }

      const leftTerminal = window
        .locator('.terminal-node')
        .filter({ hasText: 'terminal-multi-marquee-left' })
        .first()
      const rightTerminal = window
        .locator('.terminal-node')
        .filter({ hasText: 'terminal-multi-marquee-right' })
        .first()
      await expect(leftTerminal).toBeVisible()
      await expect(rightTerminal).toBeVisible()

      const leftBox = await leftTerminal.boundingBox()
      const rightBox = await rightTerminal.boundingBox()
      if (!leftBox || !rightBox) {
        throw new Error('terminal bounding box unavailable for marquee selection')
      }

      const selectNodeByMarquee = async (targetBox: NonNullable<typeof leftBox>) => {
        const startX = Math.max(paneBox.x + 40, targetBox.x - 24)
        const startY = Math.max(paneBox.y + 40, targetBox.y - 24)
        const endX = Math.min(paneBox.x + paneBox.width - 40, targetBox.x + targetBox.width - 24)
        const endY = Math.min(paneBox.y + paneBox.height - 120, targetBox.y + targetBox.height - 24)

        await dragMouse(window, {
          start: { x: startX, y: startY },
          end: { x: endX, y: endY },
          steps: 10,
          modifiers: ['Shift'],
          draft: window.locator('.workspace-selection-draft'),
        })
        await expect(window.locator('.workspace-selection-draft')).toHaveCount(0)
      }

      await pane.click({ position: { x: 40, y: 40 } })
      await selectNodeByMarquee(leftBox)
      await selectNodeByMarquee(rightBox)

      await expect(window.locator('.react-flow__node.selected')).toHaveCount(2)

      const rightHeader = rightTerminal.locator('.terminal-node__header')
      await expect(rightHeader).toBeVisible()

      const before = await readNodePositions(window)
      if (!before) {
        throw new Error('node positions unavailable before multi-drag')
      }

      const headerBox = await rightHeader.boundingBox()
      if (!headerBox) {
        throw new Error('header bounding box unavailable for multi-drag')
      }

      const startX = headerBox.x + 140
      const startY = headerBox.y + 20
      const endX = Math.min(paneBox.x + paneBox.width - 60, startX + 240)
      const endY = Math.min(paneBox.y + paneBox.height - 60, startY + 220)

      await dragMouse(window, {
        start: { x: startX, y: startY },
        end: { x: endX, y: endY },
        steps: 12,
      })

      await expect
        .poll(async () => {
          const after = await readNodePositions(window)
          if (!after) {
            return Number.NaN
          }

          return Math.hypot(after.right.x - before.right.x, after.right.y - before.right.y)
        })
        .toBeGreaterThan(120)

      await expect
        .poll(async () => {
          const after = await readNodePositions(window)
          if (!after) {
            return Number.NaN
          }

          return Math.hypot(after.left.x - before.left.x, after.left.y - before.left.y)
        })
        .toBeGreaterThan(120)
    } finally {
      await electronApp.close()
    }
  })
})
