import { expect, test, type Locator, type Page } from '@playwright/test'
import { clearAndSeedWorkspace, launchApp, readCanvasViewport } from './workspace-canvas.helpers'
import {
  CANONICAL_GUTTER_PX,
  ensureArtifactsDir,
  readSeededWorkspaceLayout,
  resolveCanonicalNodeSizes,
} from './workspace-canvas.arrange.shared'

async function openPaneContextMenu(
  window: Page,
  pane: Locator,
  position: { x: number; y: number },
): Promise<void> {
  const box = await pane.boundingBox()
  if (!box) {
    throw new Error('Pane bounding box not available')
  }

  await pane.evaluate(
    (element, payload) => {
      const event = new MouseEvent('contextmenu', {
        button: 2,
        clientX: payload.clientX,
        clientY: payload.clientY,
        bubbles: true,
        cancelable: true,
      })
      element.dispatchEvent(event)
    },
    {
      clientX: box.x + position.x,
      clientY: box.y + position.y,
    },
  )
}

test.describe('Workspace Canvas - Arrange', () => {
  test('shows arrange actions in pane menu and arranges canvas deterministically', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(window, [
        {
          id: 'arrange-node-1',
          title: 'arrange-1',
          position: { x: 450, y: 140 },
          width: 320,
          height: 240,
        },
        {
          id: 'arrange-node-2',
          title: 'arrange-2',
          position: { x: 113, y: 119 },
          width: 320,
          height: 240,
        },
      ])

      const pane = window.locator('.workspace-canvas .react-flow__pane')
      await expect(pane).toBeVisible()
      await expect(window.locator('.react-flow__node')).toHaveCount(2)
      const canonicalSizes = await resolveCanonicalNodeSizes(window)
      const terminalSize = canonicalSizes.terminal

      const paneBox = await pane.boundingBox()
      if (!paneBox) {
        throw new Error('Pane bounding box not available')
      }

      await openPaneContextMenu(window, pane, {
        x: Math.floor(paneBox.width * 0.5),
        y: Math.floor(paneBox.height * 0.45),
      })

      await expect(window.locator('.workspace-context-menu')).toBeVisible()
      await expect(window.locator('[data-testid="workspace-context-arrange"]')).toBeVisible()
      await expect(window.locator('[data-testid="workspace-context-arrange-by"]')).toBeVisible()
      await expect(window.locator('[data-testid="workspace-context-arrange"]')).toBeEnabled()

      await ensureArtifactsDir()
      await window.locator('.workspace-context-menu').screenshot({
        path: 'artifacts/workspace-canvas-arrange.context-menu.png',
      })

      await window.locator('[data-testid="workspace-context-arrange"]').click()
      await expect(window.locator('.workspace-context-menu')).toHaveCount(0)

      await expect
        .poll(async () => {
          return await readSeededWorkspaceLayout(window, {
            nodeIds: ['arrange-node-1', 'arrange-node-2'],
            spaceIds: [],
          })
        })
        .toEqual({
          nodes: {
            'arrange-node-1': {
              x: 96 + terminalSize.width + CANONICAL_GUTTER_PX,
              y: 96,
              ...terminalSize,
            },
            'arrange-node-2': { x: 96, y: 96, ...terminalSize },
          },
          spaces: {},
        })

      await window.screenshot({ path: 'artifacts/workspace-canvas-arrange.canvas-after.png' })
    } finally {
      await electronApp.close()
    }
  })

  test('keeps arrange stable across canvas zoom and auto-fits all nodes afterward', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(window, [
        {
          id: 'zoom-arrange-1',
          title: 'zoom-arrange-1',
          position: { x: 120, y: 120 },
          width: 320,
          height: 240,
        },
        {
          id: 'zoom-arrange-2',
          title: 'zoom-arrange-2',
          position: { x: 720, y: 120 },
          width: 320,
          height: 240,
        },
        {
          id: 'zoom-arrange-3',
          title: 'zoom-arrange-3',
          position: { x: 1320, y: 120 },
          width: 320,
          height: 240,
        },
        {
          id: 'zoom-arrange-4',
          title: 'zoom-arrange-4',
          position: { x: 160, y: 560 },
          width: 320,
          height: 240,
        },
        {
          id: 'zoom-arrange-5',
          title: 'zoom-arrange-5',
          position: { x: 760, y: 560 },
          width: 320,
          height: 240,
        },
        {
          id: 'zoom-arrange-6',
          title: 'zoom-arrange-6',
          position: { x: 1360, y: 560 },
          width: 320,
          height: 240,
        },
      ])

      const pane = window.locator('.workspace-canvas .react-flow__pane')
      await expect(pane).toBeVisible()
      const canonicalSizes = await resolveCanonicalNodeSizes(window)
      const terminalSize = canonicalSizes.terminal
      const strideX = terminalSize.width + CANONICAL_GUTTER_PX
      const strideY = terminalSize.height + CANONICAL_GUTTER_PX

      const zoomInButton = window.locator('.react-flow__controls-zoomin')
      await expect(zoomInButton).toBeVisible()
      await zoomInButton.click()
      await zoomInButton.click()

      const zoomBeforeArrange = (await readCanvasViewport(window)).zoom
      expect(zoomBeforeArrange).toBeGreaterThan(1.01)

      const viewport = await readCanvasViewport(window)
      await openPaneContextMenu(window, pane, {
        x: 50 * viewport.zoom + viewport.x,
        y: 50 * viewport.zoom + viewport.y,
      })

      await expect(window.locator('[data-testid="workspace-context-arrange"]')).toBeEnabled()
      await window.locator('[data-testid="workspace-context-arrange"]').click()

      await expect
        .poll(async () => {
          return await readSeededWorkspaceLayout(window, {
            nodeIds: [
              'zoom-arrange-1',
              'zoom-arrange-2',
              'zoom-arrange-3',
              'zoom-arrange-4',
              'zoom-arrange-5',
              'zoom-arrange-6',
            ],
            spaceIds: [],
          })
        })
        .toEqual({
          nodes: {
            'zoom-arrange-1': { x: 120, y: 120, ...terminalSize },
            'zoom-arrange-2': { x: 120 + strideX, y: 120, ...terminalSize },
            'zoom-arrange-3': { x: 120 + strideX * 2, y: 120, ...terminalSize },
            'zoom-arrange-4': { x: 120, y: 120 + strideY, ...terminalSize },
            'zoom-arrange-5': { x: 120 + strideX, y: 120 + strideY, ...terminalSize },
            'zoom-arrange-6': { x: 120 + strideX * 2, y: 120 + strideY, ...terminalSize },
          },
          spaces: {},
        })

      await expect
        .poll(async () => {
          return (await readCanvasViewport(window)).zoom
        })
        .toBeLessThan(zoomBeforeArrange)

      await expect
        .poll(async () => {
          const canvasBox = await window.locator('.workspace-canvas .react-flow').boundingBox()
          const nodeBoxes = await window.locator('.react-flow__node').evaluateAll(elements =>
            elements.map(element => {
              const rect = element.getBoundingClientRect()
              return {
                left: rect.left,
                top: rect.top,
                right: rect.right,
                bottom: rect.bottom,
              }
            }),
          )

          if (!canvasBox) {
            return false
          }

          return nodeBoxes.every(box => {
            return (
              box.left >= canvasBox.x &&
              box.top >= canvasBox.y &&
              box.right <= canvasBox.x + canvasBox.width &&
              box.bottom <= canvasBox.y + canvasBox.height
            )
          })
        })
        .toBe(true)

      await ensureArtifactsDir()
      await window.screenshot({ path: 'artifacts/workspace-canvas-arrange.zoom-fit-after.png' })
    } finally {
      await electronApp.close()
    }
  })
})
