import { expect, test } from '@playwright/test'
import { clearAndSeedWorkspace, launchApp, storageKey } from './workspace-canvas.helpers'

test.describe('Workspace Canvas - Selection (Terminal Drag)', () => {
  test('only enables selected drag surface during multi-select', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'mouse-selected-body-drag-node-a',
            title: 'terminal-mouse-selected-body-drag-a',
            position: { x: 220, y: 180 },
            width: 460,
            height: 300,
          },
          {
            id: 'mouse-selected-body-drag-node-b',
            title: 'terminal-mouse-selected-body-drag-b',
            position: { x: 740, y: 180 },
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
        .filter({ hasText: 'terminal-mouse-selected-body-drag-a' })
        .first()
      const headerA = terminalA.locator('.terminal-node__header')
      const terminalBodyA = terminalA.locator('.terminal-node__terminal')

      const terminalB = window
        .locator('.terminal-node')
        .filter({ hasText: 'terminal-mouse-selected-body-drag-b' })
        .first()
      const headerB = terminalB.locator('.terminal-node__header')

      await expect(headerA).toBeVisible()
      await expect(terminalBodyA).toBeVisible()
      await expect(headerB).toBeVisible()

      const readNodePosition = async (
        targetNodeId: string,
      ): Promise<{ x: number; y: number } | null> => {
        return await window.evaluate(
          async ({ key, nodeId: requestedNodeId }) => {
            void key

            const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
            if (!raw) {
              return null
            }

            const state = JSON.parse(raw) as {
              workspaces?: Array<{
                nodes?: Array<{
                  id: string
                  position?: { x?: number; y?: number }
                }>
              }>
            }

            const node = state.workspaces?.[0]?.nodes?.find(entry => entry.id === requestedNodeId)

            if (
              !node?.position ||
              typeof node.position.x !== 'number' ||
              typeof node.position.y !== 'number'
            ) {
              return null
            }

            return {
              x: node.position.x,
              y: node.position.y,
            }
          },
          { key: storageKey, nodeId: targetNodeId },
        )
      }

      await headerA.click({ position: { x: 40, y: 20 } })
      await expect(window.locator('.react-flow__node.selected')).toHaveCount(1)
      await expect(window.locator('.workspace-canvas')).toHaveAttribute(
        'data-cove-drag-surface-selection-mode',
        'false',
      )

      const membraneAfterSingleSelect = await terminalA.evaluate(
        element => window.getComputedStyle(element, '::after').content,
      )
      expect(membraneAfterSingleSelect).toBe('none')

      await window.keyboard.down('Shift')
      try {
        await headerB.click({ position: { x: 40, y: 20 } })
      } finally {
        await window.keyboard.up('Shift')
      }
      await expect(window.locator('.react-flow__node.selected')).toHaveCount(2)
      await expect(window.locator('.workspace-canvas')).toHaveAttribute(
        'data-cove-drag-surface-selection-mode',
        'true',
      )

      const membraneAfterMultiSelect = await terminalA.evaluate(
        element => window.getComputedStyle(element, '::after').content,
      )
      if (!membraneAfterMultiSelect || membraneAfterMultiSelect === 'none') {
        throw new Error(
          `expected membrane ::after after multi-select, got content=${membraneAfterMultiSelect}`,
        )
      }

      const beforeDrag = await readNodePosition('mouse-selected-body-drag-node-a')
      if (!beforeDrag) {
        throw new Error('node position unavailable before multi-select body drag')
      }

      const pane = window.locator('.workspace-canvas .react-flow__pane')
      await expect(pane).toBeVisible()
      const paneBox = await pane.boundingBox()
      const bodyBox = await terminalBodyA.boundingBox()
      if (!paneBox || !bodyBox) {
        throw new Error('pane/body bounding box unavailable for multi-select body drag')
      }

      const startX = bodyBox.x + bodyBox.width * 0.4
      const startY = bodyBox.y + bodyBox.height * 0.4
      const endX = Math.min(paneBox.x + paneBox.width - 60, startX + 260)
      const endY = Math.min(paneBox.y + paneBox.height - 60, startY + 220)

      await window.mouse.move(startX, startY)
      await window.mouse.down()
      await window.mouse.move(endX, endY, { steps: 36 })
      await window.mouse.up()

      const afterDrag = await readNodePosition('mouse-selected-body-drag-node-a')
      if (!afterDrag) {
        throw new Error('node position unavailable after multi-select body drag')
      }

      expect(afterDrag.x).toBeGreaterThan(beforeDrag.x + 120)
      expect(afterDrag.y).toBeGreaterThan(beforeDrag.y + 120)
    } finally {
      await electronApp.close()
    }
  })
})
