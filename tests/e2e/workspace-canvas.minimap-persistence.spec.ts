import { expect, test } from '@playwright/test'
import {
  clearAndSeedWorkspace,
  dragMouse,
  launchApp,
  readCanvasViewport,
  readWorkspaceViewState,
  seededWorkspaceId,
} from './workspace-canvas.helpers'

test.describe('Workspace Canvas - Minimap Persistence', () => {
  test('preserves canvas viewport and minimap visibility after app reload', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(window, [
        {
          id: 'node-viewport-reload',
          title: 'terminal-viewport-reload',
          position: { x: 360, y: 280 },
          width: 460,
          height: 300,
        },
      ])

      const zoomInButton = window.locator('.react-flow__controls-zoomin')
      await expect(zoomInButton).toBeVisible()
      await zoomInButton.click()
      await zoomInButton.click()

      const pane = window.locator('.workspace-canvas .react-flow__pane')
      await expect(pane).toBeVisible()
      const paneBox = await pane.boundingBox()
      if (!paneBox) {
        throw new Error('workspace pane bounding box unavailable')
      }

      await dragMouse(window, {
        start: { x: paneBox.x + 420, y: paneBox.y + 320 },
        end: { x: paneBox.x + 260, y: paneBox.y + 220 },
      })

      const minimapDock = window.locator('.workspace-canvas__minimap-dock')
      await minimapDock.hover()
      const minimapToggle = window.locator('[data-testid="workspace-minimap-toggle"]')
      await expect(minimapToggle).toBeVisible()
      await minimapToggle.dispatchEvent('click')
      await expect(window.locator('.workspace-canvas__minimap')).toHaveCount(0)

      const currentViewport = await readCanvasViewport(window)

      await expect
        .poll(
          async () => {
            return await readWorkspaceViewState(window, seededWorkspaceId)
          },
          { timeout: 10_000 },
        )
        .toMatchObject({
          isMinimapVisible: false,
        })
      await expect
        .poll(async () => (await readWorkspaceViewState(window, seededWorkspaceId))?.viewport.zoom)
        .toBeGreaterThan(1.01)

      const persistedViewport = (await readWorkspaceViewState(window, seededWorkspaceId))?.viewport

      if (!persistedViewport) {
        throw new Error('Persisted viewport not found after canvas interactions')
      }

      await window.reload({ waitUntil: 'domcontentloaded' })
      await expect(window.locator('.workspace-canvas__minimap')).toHaveCount(0)

      await expect
        .poll(async () => {
          const current = await readCanvasViewport(window)
          return current.zoom
        })
        .toBeCloseTo(currentViewport.zoom, 2)

      await expect
        .poll(async () => {
          const current = await readCanvasViewport(window)
          return Math.abs(current.x - currentViewport.x)
        })
        .toBeLessThan(6)

      await expect
        .poll(async () => {
          const current = await readCanvasViewport(window)
          return Math.abs(current.y - currentViewport.y)
        })
        .toBeLessThan(6)
    } finally {
      await electronApp.close()
    }
  })
})
