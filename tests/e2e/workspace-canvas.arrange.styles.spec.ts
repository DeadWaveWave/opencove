import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  clearAndSeedWorkspace,
  launchApp,
  readCanvasViewport,
  testWorkspacePath,
} from './workspace-canvas.helpers'
import { ensureArtifactsDir, readSeededWorkspaceLayout } from './workspace-canvas.arrange.shared'

async function openPaneContextMenuAtFlowPoint(
  window: Page,
  pane: Locator,
  point: { x: number; y: number },
): Promise<void> {
  const box = await pane.boundingBox()
  if (!box) {
    throw new Error('Pane bounding box not available')
  }

  const viewport = await readCanvasViewport(window)
  const clientX = box.x + point.x * viewport.zoom + viewport.x
  const clientY = box.y + point.y * viewport.zoom + viewport.y

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
    { clientX, clientY },
  )
}

async function clickPaneAtFlowPoint(
  window: Page,
  pane: Locator,
  point: { x: number; y: number },
): Promise<void> {
  const box = await pane.boundingBox()
  if (!box) {
    throw new Error('Pane bounding box not available')
  }

  const viewport = await readCanvasViewport(window)
  await window.mouse.click(
    box.x + point.x * viewport.zoom + viewport.x,
    box.y + point.y * viewport.zoom + viewport.y,
  )
}

async function openPaneContextMenuInSpace(
  window: Page,
  pane: Locator,
  spaceId: string,
): Promise<void> {
  const layout = await readSeededWorkspaceLayout(window, { nodeIds: [], spaceIds: [spaceId] })
  const rect = layout.spaces[spaceId]
  if (!rect) {
    throw new Error(`Space rect not available: ${spaceId}`)
  }

  const inset = 12
  await openPaneContextMenuAtFlowPoint(window, pane, {
    x: rect.x + inset,
    y: rect.y + Math.max(inset, Math.min(760, rect.height - inset)),
  })
}

function rectsOverlap(
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number },
): boolean {
  return (
    left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y
  )
}

test.describe('Workspace Canvas - Arrange', () => {
  test('arrange-by menu can align standard sizes + dense packing for tight tiling', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'tile-1',
            title: 'tile-1',
            position: { x: 0, y: 0 },
            width: 470,
            height: 650,
          },
          {
            id: 'tile-2',
            title: 'tile-2',
            position: { x: 0, y: 0 },
            width: 468,
            height: 660,
          },
          {
            id: 'tile-3',
            title: 'tile-3',
            position: { x: 0, y: 0 },
            width: 455,
            height: 645,
          },
          {
            id: 'tile-4',
            title: 'tile-4',
            position: { x: 0, y: 0 },
            width: 480,
            height: 670,
          },
        ],
        {
          spaces: [
            {
              id: 'space-tiles',
              name: 'Tiles',
              directoryPath: testWorkspacePath,
              nodeIds: ['tile-1', 'tile-2', 'tile-3', 'tile-4'],
              rect: { x: 100, y: 100, width: 1024, height: 800 },
            },
          ],
          activeSpaceId: null,
        },
      )

      const pane = window.locator('.workspace-canvas .react-flow__pane')
      await expect(pane).toBeVisible()
      await expect(window.locator('.react-flow__node')).toHaveCount(4)
      await expect(window.locator('.workspace-space-region')).toHaveCount(1)

      await openPaneContextMenuInSpace(window, pane, 'space-tiles')

      await expect(window.locator('.workspace-context-menu')).toBeVisible()
      await window.locator('[data-testid="workspace-context-arrange-by"]').click()
      await expect(
        window.locator('[data-testid="workspace-context-arrange-by-menu"]'),
      ).toBeVisible()

      await ensureArtifactsDir()
      await window.screenshot({ path: 'artifacts/workspace-canvas-arrange.arrange-by-menu.png' })

      await window.locator('[data-testid="workspace-context-arrange-standard-sizes"]').click()
      await expect(
        window.locator('[data-testid="workspace-context-arrange-by-menu"]'),
      ).toBeVisible()

      await expect(
        window.locator('[data-testid="workspace-context-arrange-standard-sizes"] svg'),
      ).toHaveCount(1)
      await window.screenshot({
        path: 'artifacts/workspace-canvas-arrange.arrange-by-menu.standard-sizes.png',
      })

      await window.locator('[data-testid="workspace-context-arrange-dense"]').click()
      await expect(
        window.locator('[data-testid="workspace-context-arrange-by-menu"]'),
      ).toBeVisible()

      await expect
        .poll(async () => {
          return await readSeededWorkspaceLayout(window, {
            nodeIds: ['tile-1', 'tile-2', 'tile-3', 'tile-4'],
            spaceIds: ['space-tiles'],
          })
        })
        .toEqual({
          nodes: {
            'tile-1': { x: 124, y: 124, width: 464, height: 656 },
            'tile-2': { x: 588, y: 124, width: 464, height: 656 },
            'tile-3': { x: 124, y: 780, width: 464, height: 656 },
            'tile-4': { x: 588, y: 780, width: 464, height: 656 },
          },
          spaces: {
            'space-tiles': { x: 100, y: 100, width: 976, height: 1360 },
          },
        })

      await clickPaneAtFlowPoint(window, pane, { x: 20, y: 20 })
      await expect(window.locator('.workspace-context-menu')).toHaveCount(0)
      await window.screenshot({
        path: 'artifacts/workspace-canvas-arrange.standard-dense-tiles.png',
      })
    } finally {
      await electronApp.close()
    }
  })

  test('spiral layout keeps submenu open and places spaces above root nodes', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'root-a',
            title: 'root-a',
            position: { x: 80, y: 40 },
            width: 320,
            height: 240,
          },
          {
            id: 'root-b',
            title: 'root-b',
            position: { x: 960, y: 80 },
            width: 320,
            height: 240,
          },
          {
            id: 'space-a',
            title: 'space-a',
            position: { x: 620, y: 340 },
            width: 320,
            height: 240,
          },
          {
            id: 'space-b',
            title: 'space-b',
            position: { x: 980, y: 340 },
            width: 320,
            height: 240,
          },
        ],
        {
          spaces: [
            {
              id: 'space-1',
              name: 'Space 1',
              directoryPath: testWorkspacePath,
              nodeIds: ['space-a', 'space-b'],
              rect: { x: 580, y: 300, width: 760, height: 320 },
            },
          ],
          activeSpaceId: null,
        },
      )

      const pane = window.locator('.workspace-canvas .react-flow__pane')
      await expect(pane).toBeVisible()

      await openPaneContextMenuAtFlowPoint(window, pane, { x: 40, y: 40 })

      await expect(window.locator('.workspace-context-menu')).toBeVisible()
      await window.locator('[data-testid="workspace-context-arrange-by"]').click()
      await expect(
        window.locator('[data-testid="workspace-context-arrange-by-menu"]'),
      ).toBeVisible()

      await window.locator('[data-testid="workspace-context-arrange-layout-spiral"]').click()
      await expect(
        window.locator('[data-testid="workspace-context-arrange-by-menu"]'),
      ).toBeVisible()
      await expect(window.locator('[data-testid="workspace-context-arrange"]')).toBeVisible()

      await ensureArtifactsDir()
      await window.screenshot({
        path: 'artifacts/workspace-canvas-arrange.spiral-layout-menu.png',
      })

      await expect
        .poll(async () => {
          return await readSeededWorkspaceLayout(window, {
            nodeIds: ['root-a', 'root-b', 'space-a', 'space-b'],
            spaceIds: ['space-1'],
          })
        })
        .toMatchObject({
          nodes: {
            'root-a': { width: 320, height: 240 },
            'root-b': { width: 320, height: 240 },
            'space-a': { width: 320, height: 240 },
            'space-b': { width: 320, height: 240 },
          },
        })
      const layout = await readSeededWorkspaceLayout(window, {
        nodeIds: ['root-a', 'root-b', 'space-a', 'space-b'],
        spaceIds: ['space-1'],
      })

      const spaceRect = layout.spaces['space-1']
      const rootA = layout.nodes['root-a']
      const rootB = layout.nodes['root-b']

      expect(spaceRect).toBeTruthy()
      expect(rootA).toBeTruthy()
      expect(rootB).toBeTruthy()
      expect(spaceRect!.y + spaceRect!.height).toBeLessThanOrEqual(Math.min(rootA!.y, rootB!.y))
      expect(rectsOverlap(rootA!, rootB!)).toBe(false)

      await clickPaneAtFlowPoint(window, pane, { x: 20, y: 20 })
      await expect(window.locator('.workspace-context-menu')).toHaveCount(0)
      await window.screenshot({
        path: 'artifacts/workspace-canvas-arrange.spiral-layout-canvas.png',
      })
    } finally {
      await electronApp.close()
    }
  })
})
