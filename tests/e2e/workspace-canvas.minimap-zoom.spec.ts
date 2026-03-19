import { expect, test } from '@playwright/test'
import {
  clearAndSeedWorkspace,
  dragMouse,
  dragLocatorTo,
  launchApp,
  readCanvasViewport,
  seededWorkspaceId,
  storageKey,
} from './workspace-canvas.helpers'

test.describe('Workspace Canvas - Minimap & Zoom', () => {
  test('renders subdued canvas controls and collapsible minimap', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(window, [
        {
          id: 'node-controls-minimap',
          title: 'terminal-controls-minimap',
          position: { x: 180, y: 140 },
          width: 460,
          height: 300,
        },
      ])

      const controls = window.locator('.workspace-canvas__controls')
      await expect(controls).toBeVisible()

      const controlsOpacity = await controls.evaluate(element => {
        return Number.parseFloat(window.getComputedStyle(element).opacity)
      })
      expect(controlsOpacity).toBeLessThan(0.8)

      const minimapToggle = window.locator('[data-testid="workspace-minimap-toggle"]')
      const minimap = window.locator('.workspace-canvas__minimap')
      await expect(minimap).toBeVisible()

      const minimapOpacity = await minimap.evaluate(element => {
        return Number.parseFloat(window.getComputedStyle(element).opacity)
      })
      expect(minimapOpacity).toBeLessThan(0.5)

      await expect(minimapToggle).toHaveCSS('visibility', 'hidden')

      await window.locator('.workspace-canvas__minimap-dock').hover()
      await expect(minimapToggle).toBeVisible()
      await expect(minimapToggle).toHaveCSS('visibility', 'visible')
      await expect(minimapToggle).toHaveAttribute('aria-label', 'Hide minimap')

      await minimapToggle.click()
      await expect(minimap).toHaveCount(0)
      await expect(minimapToggle).toBeVisible()
      await expect(minimapToggle).toHaveCSS('visibility', 'visible')
      await expect(minimapToggle).toHaveAttribute('aria-label', 'Show minimap')

      await minimapToggle.click()
      await expect(minimap).toBeVisible()
      await window.locator('.workspace-canvas .react-flow__pane').hover()
      await expect(minimapToggle).toHaveCSS('visibility', 'hidden')
      await expect(minimapToggle).toHaveAttribute('aria-label', 'Hide minimap')
    } finally {
      await electronApp.close()
    }
  })

  test('dragging terminal header does not normalize canvas zoom', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(window, [
        {
          id: 'node-header-zoom',
          title: 'terminal-header-zoom',
          position: { x: 120, y: 120 },
          width: 460,
          height: 300,
        },
      ])

      const zoomInButton = window.locator('.react-flow__controls-zoomin')
      await expect(zoomInButton).toBeVisible()

      await zoomInButton.click()
      await zoomInButton.click()

      const zoomBefore = (await readCanvasViewport(window)).zoom
      expect(zoomBefore).toBeGreaterThan(1.01)

      const terminal = window.locator('.terminal-node').first()
      await expect(terminal).toBeVisible()

      const header = terminal.locator('.terminal-node__header')
      const pane = window.locator('.workspace-canvas .react-flow__pane')
      await expect(pane).toBeVisible()

      await dragLocatorTo(window, header, pane, {
        sourcePosition: { x: 120, y: 16 },
        targetPosition: { x: 680, y: 420 },
      })

      await expect
        .poll(async () => {
          return (await readCanvasViewport(window)).zoom
        })
        .toBeGreaterThan(1.01)

      await expect(window.locator('.react-flow__node.dragging')).toHaveCount(0)

      const terminalBody = terminal.locator('.terminal-node__terminal')
      const terminalBox = await terminalBody.boundingBox()
      if (!terminalBox) {
        throw new Error('terminal bounding box unavailable for normalization click')
      }

      // Click near the center of the terminal to avoid occluded edges after drag while zoomed-in.
      await window.mouse.click(
        terminalBox.x + terminalBox.width / 2,
        terminalBox.y + Math.min(96, terminalBox.height / 2),
      )

      await expect
        .poll(async () => {
          return (await readCanvasViewport(window)).zoom
        })
        .toBeCloseTo(1, 2)
    } finally {
      await electronApp.close()
    }
  })

  test('normalizes canvas zoom and centers clicked terminal', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(window, [
        {
          id: 'node-zoom-1',
          title: 'terminal-zoom-1',
          position: { x: 120, y: 120 },
          width: 460,
          height: 300,
        },
        {
          id: 'node-zoom-2',
          title: 'terminal-zoom-2',
          position: { x: 700, y: 440 },
          width: 460,
          height: 300,
        },
      ])

      const zoomInButton = window.locator('.react-flow__controls-zoomin')
      await expect(zoomInButton).toBeVisible()

      await zoomInButton.click()
      await zoomInButton.click()

      const zoomBefore = (await readCanvasViewport(window)).zoom
      expect(zoomBefore).toBeGreaterThan(1.01)

      const secondTerminal = window.locator('.terminal-node').filter({ hasText: 'terminal-zoom-2' })
      await expect(secondTerminal).toBeVisible()

      const readCenterDelta = async (): Promise<{ dx: number; dy: number }> => {
        const canvasBox = await window.locator('.workspace-canvas .react-flow').boundingBox()
        const terminalBox = await secondTerminal.boundingBox()

        if (!canvasBox || !terminalBox) {
          return {
            dx: Number.POSITIVE_INFINITY,
            dy: Number.POSITIVE_INFINITY,
          }
        }

        const canvasCenterX = canvasBox.x + canvasBox.width / 2
        const canvasCenterY = canvasBox.y + canvasBox.height / 2
        const terminalCenterX = terminalBox.x + terminalBox.width / 2
        const terminalCenterY = terminalBox.y + terminalBox.height / 2

        return {
          dx: Math.abs(canvasCenterX - terminalCenterX),
          dy: Math.abs(canvasCenterY - terminalCenterY),
        }
      }

      const deltaBefore = await readCenterDelta()
      expect(deltaBefore.dx).toBeGreaterThan(120)

      const terminalBody = secondTerminal.locator('.terminal-node__terminal')
      await expect(terminalBody).toBeVisible()
      // Click further inside the terminal surface to avoid edge resize handles after zoom.
      const safeOffsetX = Math.ceil(16 + zoomBefore * 10)
      await terminalBody.click({ position: { x: safeOffsetX, y: 24 } })

      await expect
        .poll(async () => {
          return (await readCanvasViewport(window)).zoom
        })
        .toBeCloseTo(1, 2)

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

  test('normalizes canvas zoom for clicked task but not header drag', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(window, [
        {
          id: 'task-click-focus',
          title: 'Focus task viewport',
          position: { x: 640, y: 420 },
          width: 460,
          height: 280,
          kind: 'task',
          task: {
            requirement: 'Clicking this task should center the viewport.',
            status: 'doing',
            priority: 'medium',
            tags: ['focus'],
            linkedAgentNodeId: null,
            lastRunAt: null,
            autoGeneratedTitle: false,
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

      const taskNode = window.locator('.task-node').first()
      await expect(taskNode).toBeVisible()

      const pane = window.locator('.workspace-canvas .react-flow__pane')
      await expect(pane).toBeVisible()

      await dragLocatorTo(window, taskNode.locator('.task-node__header'), pane, {
        sourcePosition: { x: 120, y: 18 },
        targetPosition: { x: 240, y: 220 },
      })

      await expect
        .poll(async () => {
          return (await readCanvasViewport(window)).zoom
        })
        .toBeGreaterThan(1.01)

      await taskNode.locator('.task-node__requirement-input').click({
        position: { x: 48, y: 36 },
      })

      await expect
        .poll(async () => {
          return (await readCanvasViewport(window)).zoom
        })
        .toBeCloseTo(1, 2)

      const readCenterDelta = async (): Promise<{ dx: number; dy: number }> => {
        const canvasBox = await window.locator('.workspace-canvas .react-flow').boundingBox()
        const taskBox = await taskNode.boundingBox()

        if (!canvasBox || !taskBox) {
          return {
            dx: Number.POSITIVE_INFINITY,
            dy: Number.POSITIVE_INFINITY,
          }
        }

        const canvasCenterX = canvasBox.x + canvasBox.width / 2
        const canvasCenterY = canvasBox.y + canvasBox.height / 2
        const taskCenterX = taskBox.x + taskBox.width / 2
        const taskCenterY = taskBox.y + taskBox.height / 2

        return {
          dx: Math.abs(canvasCenterX - taskCenterX),
          dy: Math.abs(canvasCenterY - taskCenterY),
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
