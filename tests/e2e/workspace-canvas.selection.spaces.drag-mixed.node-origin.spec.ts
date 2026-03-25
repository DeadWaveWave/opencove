import { expect, test } from '@playwright/test'
import {
  clearAndSeedWorkspace,
  launchApp,
  storageKey,
  testWorkspacePath,
} from './workspace-canvas.helpers'

test.describe('Workspace Canvas - Selection (Spaces)', () => {
  test('pushes away other spaces when dragging a node with a selected space', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'mixed-node-origin-inside-a',
            title: 'terminal-mixed-node-origin-inside-a',
            position: { x: 240, y: 200 },
            width: 460,
            height: 300,
          },
          {
            id: 'mixed-node-origin-outside',
            title: 'terminal-mixed-node-origin-outside',
            position: { x: 260, y: 600 },
            width: 460,
            height: 300,
          },
          {
            id: 'mixed-node-origin-inside-b',
            title: 'terminal-mixed-node-origin-inside-b',
            position: { x: 800, y: 200 },
            width: 460,
            height: 300,
          },
        ],
        {
          spaces: [
            {
              id: 'mixed-node-origin-space-a',
              name: 'Mixed Node Origin A',
              directoryPath: testWorkspacePath,
              nodeIds: ['mixed-node-origin-inside-a'],
              rect: { x: 200, y: 160, width: 500, height: 400 },
            },
            {
              id: 'mixed-node-origin-space-b',
              name: 'Mixed Node Origin B',
              directoryPath: testWorkspacePath,
              nodeIds: ['mixed-node-origin-inside-b'],
              rect: { x: 760, y: 160, width: 500, height: 400 },
            },
          ],
          activeSpaceId: null,
          settings: {
            canvasInputMode: 'mouse',
          },
        },
      )

      const pane = window.locator('.workspace-canvas .react-flow__pane')
      await expect(pane).toBeVisible()

      const spaceATopHandle = window.locator(
        '[data-testid="workspace-space-drag-mixed-node-origin-space-a-top"]',
      )
      await expect(spaceATopHandle).toBeVisible()
      await spaceATopHandle.click()
      await expect(window.locator('.workspace-space-region--selected')).toHaveCount(1)

      const outsideNode = window
        .locator('.terminal-node')
        .filter({ hasText: 'terminal-mixed-node-origin-outside' })
        .first()
      const outsideHeader = outsideNode.locator('.terminal-node__header')
      await expect(outsideHeader).toBeVisible()

      await window.keyboard.down('Shift')
      try {
        await outsideHeader.click({ position: { x: 40, y: 20 } })
      } finally {
        await window.keyboard.up('Shift')
      }

      await expect(window.locator('.workspace-space-region--selected')).toHaveCount(1)
      await expect(window.locator('.react-flow__node.selected')).toHaveCount(1)
      await expect(window.locator('.workspace-canvas')).toHaveAttribute(
        'data-cove-drag-surface-selection-mode',
        'true',
      )

      const readState = async (): Promise<{ spaceAX: number; spaceBX: number } | null> => {
        return await window.evaluate(
          async ({ key, spaceAId, spaceBId }) => {
            void key

            const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
            if (!raw) {
              return null
            }

            const parsed = JSON.parse(raw) as {
              workspaces?: Array<{
                spaces?: Array<{
                  id?: string
                  rect?: { x?: number } | null
                }>
              }>
            }

            const workspace = parsed.workspaces?.[0]
            const spaceA = workspace?.spaces?.find(entry => entry.id === spaceAId)
            const spaceB = workspace?.spaces?.find(entry => entry.id === spaceBId)

            if (
              !spaceA?.rect ||
              typeof spaceA.rect.x !== 'number' ||
              !spaceB?.rect ||
              typeof spaceB.rect.x !== 'number'
            ) {
              return null
            }

            return {
              spaceAX: spaceA.rect.x,
              spaceBX: spaceB.rect.x,
            }
          },
          {
            key: storageKey,
            spaceAId: 'mixed-node-origin-space-a',
            spaceBId: 'mixed-node-origin-space-b',
          },
        )
      }

      const before = await readState()
      if (!before) {
        throw new Error('failed to read initial node-origin space rects')
      }

      const outsideHeaderBox = await outsideHeader.boundingBox()
      if (!outsideHeaderBox) {
        throw new Error('outside node header bounding box unavailable for node-origin drag')
      }

      const dragStartX = outsideHeaderBox.x + outsideHeaderBox.width * 0.5
      const dragStartY = outsideHeaderBox.y + outsideHeaderBox.height * 0.5
      const dragDx = 340
      const dragDy = 0

      await window.mouse.move(dragStartX, dragStartY)
      await window.mouse.down()
      await window.mouse.move(dragStartX + dragDx, dragStartY + dragDy, { steps: 24 })
      await window.mouse.up()

      await expect
        .poll(async () => {
          const after = await readState()
          return after ? after.spaceAX - before.spaceAX : Number.NaN
        })
        .toBeGreaterThan(200)

      await expect
        .poll(async () => {
          const after = await readState()
          return after ? after.spaceBX - before.spaceBX : Number.NaN
        })
        .toBeGreaterThan(100)
    } finally {
      await electronApp.close()
    }
  })
})
