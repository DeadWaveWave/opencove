import { expect, test } from '@playwright/test'
import {
  clearAndSeedWorkspace,
  dragLocatorTo,
  launchApp,
  storageKey,
} from './workspace-canvas.helpers'

test.describe('Workspace Canvas - Selection (Terminal Drag)', () => {
  test('drags a selected terminal from its body after header selection', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'mouse-selected-body-drag-node',
            title: 'terminal-mouse-selected-body-drag',
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

      const terminal = window
        .locator('.terminal-node')
        .filter({ hasText: 'terminal-mouse-selected-body-drag' })
        .first()
      const header = terminal.locator('.terminal-node__header')
      const terminalBody = terminal.locator('.terminal-node__terminal')
      await expect(header).toBeVisible()
      await expect(terminalBody).toBeVisible()

      await header.click({ position: { x: 40, y: 20 } })
      await expect(window.locator('.react-flow__node.selected')).toHaveCount(1)

      const readNodePosition = async (): Promise<{ x: number; y: number } | null> => {
        return await window.evaluate(async key => {
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

          const node = state.workspaces?.[0]?.nodes?.find(
            entry => entry.id === 'mouse-selected-body-drag-node',
          )

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
        }, storageKey)
      }

      const beforeDrag = await readNodePosition()
      if (!beforeDrag) {
        throw new Error('node position unavailable before selected body drag')
      }

      const pane = window.locator('.workspace-canvas .react-flow__pane')
      await expect(pane).toBeVisible()
      await dragLocatorTo(window, terminalBody, pane, {
        sourcePosition: { x: 180, y: 120 },
        targetPosition: { x: 760, y: 520 },
      })

      const afterDrag = await readNodePosition()
      if (!afterDrag) {
        throw new Error('node position unavailable after selected body drag')
      }

      expect(afterDrag.x).toBeGreaterThan(beforeDrag.x + 120)
      expect(afterDrag.y).toBeGreaterThan(beforeDrag.y + 120)
    } finally {
      await electronApp.close()
    }
  })
})
