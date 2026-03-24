import { expect, test } from '@playwright/test'
import {
  clearAndSeedWorkspace,
  dragLocatorTo,
  launchApp,
  storageKey,
} from './workspace-canvas.helpers'

test.describe('Workspace Canvas - Selection (Note Drag)', () => {
  test('drags a selected note from textarea body', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'mouse-selected-note-body-drag-node',
            title: 'note',
            position: { x: 240, y: 220 },
            width: 420,
            height: 280,
            kind: 'note',
            task: {
              text: 'selected note drag body',
            },
          },
        ],
        {
          settings: {
            canvasInputMode: 'mouse',
          },
        },
      )

      const noteNode = window.locator('.note-node').first()
      const header = noteNode.locator('.note-node__header')
      const textarea = noteNode.locator('[data-testid="note-node-textarea"]')
      await expect(header).toBeVisible()
      await expect(textarea).toBeVisible()

      await window.keyboard.down('Shift')
      try {
        await header.click({ position: { x: 40, y: 20 } })
      } finally {
        await window.keyboard.up('Shift')
      }
      await expect(window.locator('.react-flow__node.selected')).toHaveCount(1)
      await expect(window.locator('.workspace-canvas')).toHaveAttribute(
        'data-cove-drag-surface-selection-mode',
        'true',
      )

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
            entry => entry.id === 'mouse-selected-note-body-drag-node',
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
        throw new Error('note position unavailable before selected body drag')
      }

      const pane = window.locator('.workspace-canvas .react-flow__pane')
      await expect(pane).toBeVisible()
      await dragLocatorTo(window, textarea, pane, {
        sourcePosition: { x: 120, y: 60 },
        targetPosition: { x: 760, y: 520 },
      })

      const afterDrag = await readNodePosition()
      if (!afterDrag) {
        throw new Error('note position unavailable after selected body drag')
      }

      expect(afterDrag.x).toBeGreaterThan(beforeDrag.x + 120)
      expect(afterDrag.y).toBeGreaterThan(beforeDrag.y + 120)
    } finally {
      await electronApp.close()
    }
  })
})
