import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  clearAndSeedWorkspace,
  launchApp,
  readCanvasViewport,
  testWorkspacePath,
} from './workspace-canvas.helpers'
import {
  ARRANGE_PADDING_PX,
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
  test('arranges nodes inside a space without affecting root nodes', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'root-1',
            title: 'root',
            position: { x: 980, y: 140 },
            width: 320,
            height: 240,
          },
          {
            id: 'space-node-a',
            title: 'a',
            position: { x: 300, y: 300 },
            width: 400,
            height: 280,
          },
          {
            id: 'space-node-b',
            title: 'b',
            position: { x: 800, y: 310 },
            width: 360,
            height: 260,
          },
          {
            id: 'space-node-c',
            title: 'c',
            position: { x: 320, y: 700 },
            width: 420,
            height: 300,
          },
        ],
        {
          spaces: [
            {
              id: 'space-1',
              name: 'Space 1',
              directoryPath: testWorkspacePath,
              nodeIds: ['space-node-a', 'space-node-b', 'space-node-c'],
              rect: { x: 100, y: 200, width: 1200, height: 800 },
            },
          ],
          activeSpaceId: null,
        },
      )

      await expect(window.locator('.workspace-space-region')).toHaveCount(1)
      await expect(window.locator('.react-flow__node')).toHaveCount(4)
      const canonicalSizes = await resolveCanonicalNodeSizes(window)
      const terminalSize = canonicalSizes.terminal
      const expectedSpaceWidth =
        ARRANGE_PADDING_PX * 2 + terminalSize.width * 2 + CANONICAL_GUTTER_PX
      const expectedSpaceHeight =
        ARRANGE_PADDING_PX * 2 + terminalSize.height * 2 + CANONICAL_GUTTER_PX

      await window.locator('[data-testid="workspace-space-menu-space-1"]').click()
      await expect(window.locator('[data-testid="workspace-space-action-menu"]')).toBeVisible()
      await expect(window.locator('[data-testid="workspace-space-action-arrange"]')).toBeEnabled()

      await window.locator('[data-testid="workspace-space-action-arrange"]').click()
      await expect(window.locator('[data-testid="workspace-space-action-menu"]')).toHaveCount(0)

      await expect
        .poll(async () => {
          return await readSeededWorkspaceLayout(window, {
            nodeIds: ['root-1', 'space-node-a', 'space-node-b', 'space-node-c'],
            spaceIds: ['space-1'],
          })
        })
        .toEqual({
          nodes: {
            'root-1': { x: 980, y: 140, width: 320, height: 240 },
            'space-node-a': { x: 124, y: 224, ...terminalSize },
            'space-node-b': {
              x: 124 + terminalSize.width + CANONICAL_GUTTER_PX,
              y: 224,
              ...terminalSize,
            },
            'space-node-c': {
              x: 124,
              y: 224 + terminalSize.height + CANONICAL_GUTTER_PX,
              ...terminalSize,
            },
          },
          spaces: {
            'space-1': { x: 100, y: 200, width: expectedSpaceWidth, height: expectedSpaceHeight },
          },
        })

      await ensureArtifactsDir()
      await window.screenshot({ path: 'artifacts/workspace-canvas-arrange.in-space-after.png' })
    } finally {
      await electronApp.close()
    }
  })

  test('shows arrange-in-space in the pane menu and warns when keep-fit has no room', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'small-a',
            title: 'a',
            position: { x: 120, y: 140 },
            width: 400,
            height: 280,
          },
          {
            id: 'small-b',
            title: 'b',
            position: { x: 560, y: 140 },
            width: 400,
            height: 280,
          },
        ],
        {
          spaces: [
            {
              id: 'space-small',
              name: 'Tiny Space',
              directoryPath: testWorkspacePath,
              nodeIds: ['small-a', 'small-b'],
              rect: { x: 100, y: 100, width: 440, height: 320 },
            },
          ],
          activeSpaceId: null,
        },
      )

      const pane = window.locator('.workspace-canvas .react-flow__pane')
      await expect(pane).toBeVisible()
      await expect(window.locator('.react-flow__node')).toHaveCount(2)
      await expect(window.locator('.workspace-space-region')).toHaveCount(1)

      const viewport = await readCanvasViewport(window)
      await openPaneContextMenu(window, pane, {
        x: 110 * viewport.zoom + viewport.x,
        y: 110 * viewport.zoom + viewport.y,
      })

      await expect(window.locator('.workspace-context-menu')).toBeVisible()
      await expect(window.locator('[data-testid="workspace-context-arrange"]')).toBeEnabled()

      await window.locator('[data-testid="workspace-context-arrange-by"]').click()
      await expect(
        window.locator('[data-testid="workspace-context-arrange-by-menu"]'),
      ).toBeVisible()
      await window.locator('[data-testid="workspace-context-arrange-space-fit-keep"]').click()
      await expect(
        window.locator('[data-testid="workspace-context-arrange-by-menu"]'),
      ).toBeVisible()

      await expect(window.locator('[data-testid="app-message"]')).toContainText(
        'Not enough room to arrange this space. Resize the space and try again.',
      )

      await expect
        .poll(async () => {
          return await readSeededWorkspaceLayout(window, {
            nodeIds: ['small-a', 'small-b'],
            spaceIds: ['space-small'],
          })
        })
        .toEqual({
          nodes: {
            'small-a': { x: 120, y: 140, width: 400, height: 280 },
            'small-b': { x: 560, y: 140, width: 400, height: 280 },
          },
          spaces: {
            'space-small': { x: 100, y: 100, width: 440, height: 320 },
          },
        })

      await ensureArtifactsDir()
      await pane.click({ position: { x: 10, y: 10 } })
      await expect(window.locator('.workspace-context-menu')).toHaveCount(0)
      await window.screenshot({
        path: 'artifacts/workspace-canvas-arrange.in-space-no-room.png',
      })
    } finally {
      await electronApp.close()
    }
  })

  test('arrange all warns about skipped spaces and still arranges eligible ones', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'small-1',
            title: 'small-1',
            position: { x: 120, y: 150 },
            width: 280,
            height: 160,
          },
          {
            id: 'small-2',
            title: 'small-2',
            position: { x: 120, y: 200 },
            width: 280,
            height: 160,
          },
          {
            id: 'big-1',
            title: 'big-1',
            position: { x: 500, y: 130 },
            width: 120,
            height: 120,
          },
          {
            id: 'big-2',
            title: 'big-2',
            position: { x: 650, y: 140 },
            width: 120,
            height: 120,
          },
          {
            id: 'big-3',
            title: 'big-3',
            position: { x: 510, y: 150 },
            width: 120,
            height: 120,
          },
        ],
        {
          spaces: [
            {
              id: 'space-small',
              name: 'Space Small',
              directoryPath: testWorkspacePath,
              nodeIds: ['small-1', 'small-2'],
              rect: { x: 96, y: 96, width: 320, height: 320 },
            },
            {
              id: 'space-big',
              name: 'Space Big',
              directoryPath: testWorkspacePath,
              nodeIds: ['big-1', 'big-2', 'big-3'],
              rect: { x: 440, y: 96, width: 996, height: 708 },
            },
          ],
          activeSpaceId: null,
        },
      )

      const pane = window.locator('.workspace-canvas .react-flow__pane')
      await expect(pane).toBeVisible()
      await expect(window.locator('.workspace-space-region')).toHaveCount(2)
      const canonicalSizes = await resolveCanonicalNodeSizes(window)
      const terminalSize = canonicalSizes.terminal
      const expectedBigSpaceWidth =
        ARRANGE_PADDING_PX * 2 + terminalSize.width * 2 + CANONICAL_GUTTER_PX
      const expectedBigSpaceHeight =
        ARRANGE_PADDING_PX * 2 + terminalSize.height * 2 + CANONICAL_GUTTER_PX
      const canArrangeBigSpace = expectedBigSpaceWidth <= 996 && expectedBigSpaceHeight <= 708

      const viewport = await readCanvasViewport(window)
      await openPaneContextMenu(window, pane, {
        x: 50 * viewport.zoom + viewport.x,
        y: 50 * viewport.zoom + viewport.y,
      })

      await expect(window.locator('.workspace-context-menu')).toBeVisible()
      await window.locator('[data-testid="workspace-context-arrange-by"]').click()
      await expect(
        window.locator('[data-testid="workspace-context-arrange-by-menu"]'),
      ).toBeVisible()
      await window.locator('[data-testid="workspace-context-arrange-space-fit-keep"]').click()
      await expect(
        window.locator('[data-testid="workspace-context-arrange-by-menu"]'),
      ).toBeVisible()
      await window.locator('[data-testid="workspace-context-arrange-scope-all"]').click()
      await expect(
        window.locator('[data-testid="workspace-context-arrange-by-menu"]'),
      ).toBeVisible()

      await expect(window.locator('[data-testid="app-message"]')).toContainText(
        `Skipped ${canArrangeBigSpace ? 1 : 2} space${canArrangeBigSpace ? '' : 's'}: not enough room to arrange.`,
      )

      await expect
        .poll(async () => {
          return await readSeededWorkspaceLayout(window, {
            nodeIds: ['small-1', 'small-2', 'big-1', 'big-2', 'big-3'],
            spaceIds: ['space-small', 'space-big'],
          })
        })
        .toEqual({
          nodes: {
            'small-1': { x: 120, y: 150, width: 280, height: 160 },
            'small-2': { x: 120, y: 200, width: 280, height: 160 },
            'big-1': canArrangeBigSpace
              ? { x: 452, y: 120, ...terminalSize }
              : { x: 488, y: 130, width: 120, height: 120 },
            'big-2': canArrangeBigSpace
              ? {
                  x: 452 + terminalSize.width + CANONICAL_GUTTER_PX,
                  y: 120,
                  ...terminalSize,
                }
              : { x: 638, y: 140, width: 120, height: 120 },
            'big-3': canArrangeBigSpace
              ? {
                  x: 452,
                  y: 120 + terminalSize.height + CANONICAL_GUTTER_PX,
                  ...terminalSize,
                }
              : { x: 498, y: 150, width: 120, height: 120 },
          },
          spaces: {
            'space-small': { x: 96, y: 96, width: 320, height: 320 },
            'space-big': canArrangeBigSpace
              ? {
                  x: 428,
                  y: 96,
                  width: expectedBigSpaceWidth,
                  height: expectedBigSpaceHeight,
                }
              : { x: 428, y: 96, width: 996, height: 708 },
          },
        })

      await ensureArtifactsDir()
      await pane.click({ position: { x: 10, y: 10 } })
      await expect(window.locator('.workspace-context-menu')).toHaveCount(0)
      await window.screenshot({ path: 'artifacts/workspace-canvas-arrange.all-after.png' })
    } finally {
      await electronApp.close()
    }
  })
})
