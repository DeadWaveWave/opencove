import { expect, test } from '@playwright/test'
import {
  clearAndSeedWorkspace,
  dragMouse,
  launchApp,
  readCanvasViewport,
  seededWorkspaceId,
  storageKey,
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

      await expect
        .poll(
          async () => {
            return await window.evaluate(
              async ({ key, workspaceId }) => {
                void key

                const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
                if (!raw) {
                  return null
                }

                const parsed = JSON.parse(raw) as {
                  workspaces?: Array<{
                    id?: string
                    viewport?: {
                      x?: number
                      y?: number
                      zoom?: number
                    }
                    isMinimapVisible?: boolean
                  }>
                }

                const workspace = parsed.workspaces?.find(item => item.id === workspaceId)
                if (!workspace?.viewport) {
                  return null
                }

                const { x, y, zoom } = workspace.viewport
                if (
                  typeof x !== 'number' ||
                  typeof y !== 'number' ||
                  typeof zoom !== 'number' ||
                  !Number.isFinite(x) ||
                  !Number.isFinite(y) ||
                  !Number.isFinite(zoom)
                ) {
                  return null
                }

                return {
                  x,
                  y,
                  zoom,
                  isMinimapVisible:
                    typeof workspace.isMinimapVisible === 'boolean'
                      ? workspace.isMinimapVisible
                      : true,
                }
              },
              {
                key: storageKey,
                workspaceId: seededWorkspaceId,
              },
            )
          },
          { timeout: 10_000 },
        )
        .toMatchObject({
          isMinimapVisible: false,
        })
      const persistedViewport = await window.evaluate<{
        x: number
        y: number
        zoom: number
      } | null>(
        async ({ key, workspaceId }) => {
          void key
          const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
          if (!raw) {
            return null
          }
          const parsed = JSON.parse(raw) as {
            workspaces?: Array<{
              id?: string
              viewport?: {
                x?: number
                y?: number
                zoom?: number
              }
            }>
          }
          const workspace = parsed.workspaces?.find(item => item.id === workspaceId)
          const viewport = workspace?.viewport
          if (
            !viewport ||
            typeof viewport.x !== 'number' ||
            typeof viewport.y !== 'number' ||
            typeof viewport.zoom !== 'number'
          ) {
            return null
          }

          return viewport
        },
        {
          key: storageKey,
          workspaceId: seededWorkspaceId,
        },
      )

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
        .toBeCloseTo(persistedViewport.zoom, 2)

      await expect
        .poll(async () => {
          const current = await readCanvasViewport(window)
          return Math.abs(current.x - persistedViewport.x)
        })
        .toBeLessThan(6)

      await expect
        .poll(async () => {
          const current = await readCanvasViewport(window)
          return Math.abs(current.y - persistedViewport.y)
        })
        .toBeLessThan(6)
    } finally {
      await electronApp.close()
    }
  })
})
