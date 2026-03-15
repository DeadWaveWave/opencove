import { expect, test } from '@playwright/test'
import { clearAndSeedWorkspace, launchApp, readCanvasViewport } from './workspace-canvas.helpers'

test.describe('Workspace Canvas - Note Focus', () => {
  test('normalizes canvas zoom for clicked note textarea without selecting the note', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(window, [
        {
          id: 'note-click-focus',
          title: 'note',
          position: { x: 880, y: 420 },
          width: 420,
          height: 280,
          kind: 'note',
          task: {
            text: 'Clicking this note should center the viewport.',
          },
        },
      ])

      const zoomInButton = window.locator('.react-flow__controls-zoomin')
      await expect(zoomInButton).toBeVisible()

      await zoomInButton.click()
      await zoomInButton.click()

      await expect
        .poll(async () => {
          return (await readCanvasViewport(window)).zoom
        })
        .toBeGreaterThan(1.01)

      const noteNode = window.locator('.note-node').first()
      await expect(noteNode).toBeVisible()

      // Keep the interactive minimap overlay from stealing the note click in smaller/offscreen windows.
      const minimapDock = window.locator('.workspace-canvas__minimap-dock')
      await expect(minimapDock).toBeVisible()
      await minimapDock.hover()
      const minimapToggle = window.locator('[data-testid="workspace-minimap-toggle"]')
      await expect(minimapToggle).toBeVisible()
      await minimapToggle.click({ force: true })
      await expect(window.locator('.workspace-canvas__minimap')).toHaveCount(0)

      const textarea = noteNode.locator('[data-testid="note-node-textarea"]')
      await expect(textarea).toBeVisible()
      await textarea.click({ position: { x: 48, y: 48 } })
      await expect(window.locator('.react-flow__node.selected')).toHaveCount(0)
      await expect(window.locator('.workspace-selection-hint')).toHaveCount(0)

      await expect
        .poll(async () => {
          return (await readCanvasViewport(window)).zoom
        })
        .toBeCloseTo(1, 2)

      const readCenterDelta = async (): Promise<{ dx: number; dy: number }> => {
        const canvasBox = await window.locator('.workspace-canvas .react-flow').boundingBox()
        const noteBox = await noteNode.boundingBox()

        if (!canvasBox || !noteBox) {
          return {
            dx: Number.POSITIVE_INFINITY,
            dy: Number.POSITIVE_INFINITY,
          }
        }

        const canvasCenterX = canvasBox.x + canvasBox.width / 2
        const canvasCenterY = canvasBox.y + canvasBox.height / 2
        const noteCenterX = noteBox.x + noteBox.width / 2
        const noteCenterY = noteBox.y + noteBox.height / 2

        return {
          dx: Math.abs(canvasCenterX - noteCenterX),
          dy: Math.abs(canvasCenterY - noteCenterY),
        }
      }

      await expect
        .poll(async () => {
          const delta = await readCenterDelta()
          return delta.dx
        })
        .toBeLessThan(140)

      await expect
        .poll(async () => {
          const delta = await readCenterDelta()
          return delta.dy
        })
        .toBeLessThan(140)
    } finally {
      await electronApp.close()
    }
  })
})
