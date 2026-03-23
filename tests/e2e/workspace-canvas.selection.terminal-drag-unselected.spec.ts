import { expect, test, type Page } from '@playwright/test'
import { clearAndSeedWorkspace, dragMouse, launchApp, storageKey } from './workspace-canvas.helpers'

test.describe('Workspace Canvas - Selection (Terminal Drag)', () => {
  const readNodePositions = async (
    window: Page,
  ): Promise<{ a: { x: number; y: number }; b: { x: number; y: number } } | null> => {
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
      const nodeA = nodes.find(entry => entry.id === 'drag-unselected-a')
      const nodeB = nodes.find(entry => entry.id === 'drag-unselected-b')

      if (
        !nodeA?.position ||
        typeof nodeA.position.x !== 'number' ||
        typeof nodeA.position.y !== 'number' ||
        !nodeB?.position ||
        typeof nodeB.position.x !== 'number' ||
        typeof nodeB.position.y !== 'number'
      ) {
        return null
      }

      return {
        a: { x: nodeA.position.x, y: nodeA.position.y },
        b: { x: nodeB.position.x, y: nodeB.position.y },
      }
    }, storageKey)
  }

  test('replaces selection when dragging an unselected terminal', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'drag-unselected-a',
            title: 'terminal-drag-unselected-a',
            position: { x: 220, y: 180 },
            width: 460,
            height: 300,
          },
          {
            id: 'drag-unselected-b',
            title: 'terminal-drag-unselected-b',
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

      const terminalA = window
        .locator('.terminal-node')
        .filter({ hasText: 'terminal-drag-unselected-a' })
        .first()
      const terminalB = window
        .locator('.terminal-node')
        .filter({ hasText: 'terminal-drag-unselected-b' })
        .first()
      await expect(terminalA).toBeVisible()
      await expect(terminalB).toBeVisible()

      const headerA = terminalA.locator('.terminal-node__header')
      const headerB = terminalB.locator('.terminal-node__header')
      await expect(headerA).toBeVisible()
      await expect(headerB).toBeVisible()

      await headerA.click({ position: { x: 40, y: 20 } })
      await expect(window.locator('.react-flow__node.selected')).toHaveCount(1)
      await expect(
        window.locator('.react-flow__node.selected .terminal-node__title').first(),
      ).toContainText('terminal-drag-unselected-a')

      const before = await readNodePositions(window)
      if (!before) {
        throw new Error('node positions unavailable before drag')
      }

      const pane = window.locator('.workspace-canvas .react-flow__pane')
      await expect(pane).toBeVisible()
      const paneBox = await pane.boundingBox()
      const headerBox = await headerB.boundingBox()
      if (!paneBox || !headerBox) {
        throw new Error('header/pane bounding box unavailable for drag')
      }

      const startX = Math.min(paneBox.x + paneBox.width - 40, headerBox.x + 140)
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

          return Math.hypot(after.b.x - before.b.x, after.b.y - before.b.y)
        })
        .toBeGreaterThan(120)

      await expect
        .poll(async () => {
          const after = await readNodePositions(window)
          if (!after) {
            return Number.NaN
          }

          return Math.hypot(after.a.x - before.a.x, after.a.y - before.a.y)
        })
        .toBeLessThan(1)

      await expect(window.locator('.react-flow__node.selected')).toHaveCount(1)
      await expect(
        window.locator('.react-flow__node.selected .terminal-node__title').first(),
      ).toContainText('terminal-drag-unselected-b')
    } finally {
      await electronApp.close()
    }
  })
})
