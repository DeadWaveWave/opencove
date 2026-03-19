import { expect, test } from '@playwright/test'
import {
  clearAndSeedWorkspace,
  launchApp,
  storageKey,
  testWorkspacePath,
} from './workspace-canvas.helpers'

test.describe('Workspace Canvas - Selection (Spaces)', () => {
  test('toggles selected space off with shift-click on the region', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'shift-click-space-node',
            title: 'terminal-shift-click-space',
            position: { x: 220, y: 180 },
            width: 240,
            height: 160,
          },
        ],
        {
          spaces: [
            {
              id: 'shift-click-space',
              name: 'Shift Click Space',
              directoryPath: testWorkspacePath,
              nodeIds: ['shift-click-space-node'],
              rect: { x: 200, y: 160, width: 540, height: 380 },
            },
          ],
          activeSpaceId: null,
          settings: {
            canvasInputMode: 'trackpad',
          },
        },
      )

      const pane = window.locator('.workspace-canvas .react-flow__pane')
      await expect(pane).toBeVisible()

      const spaceRegion = window.locator('.workspace-space-region').first()
      await expect(spaceRegion).toBeVisible()
      const paneBox = await pane.boundingBox()
      const spaceBox = await spaceRegion.boundingBox()
      if (!paneBox || !spaceBox) {
        throw new Error('workspace pane/space bounding box unavailable')
      }

      const selectionStartX = paneBox.x + 40
      const selectionStartY = paneBox.y + 40
      const selectionEndX = Math.min(
        paneBox.x + paneBox.width - 24,
        spaceBox.x + spaceBox.width * 0.35,
      )
      const selectionEndY = Math.min(
        paneBox.y + paneBox.height - 24,
        spaceBox.y + spaceBox.height * 0.35,
      )

      await window.mouse.move(selectionStartX, selectionStartY)
      await window.mouse.down()
      await window.mouse.move(selectionEndX, selectionEndY, { steps: 10 })
      await window.mouse.up()

      await expect(window.locator('.workspace-space-region--selected')).toHaveCount(1)

      const selectedTopHandle = window.locator(
        '[data-testid="workspace-space-drag-shift-click-space-top"]',
      )
      await expect(selectedTopHandle).toBeVisible()

      await window.keyboard.down('Shift')
      await selectedTopHandle.click()
      await window.keyboard.up('Shift')

      await expect(window.locator('.workspace-space-region--selected')).toHaveCount(0)
    } finally {
      await electronApp.close()
    }
  })

  test('drags selected space from the top handle', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'marquee-drag-space-node',
            title: 'terminal-marquee-drag-space',
            position: { x: 220, y: 180 },
            width: 240,
            height: 160,
          },
        ],
        {
          spaces: [
            {
              id: 'marquee-drag-space',
              name: 'Drag Selected',
              directoryPath: testWorkspacePath,
              nodeIds: ['marquee-drag-space-node'],
              rect: { x: 200, y: 160, width: 540, height: 380 },
            },
          ],
          activeSpaceId: null,
          settings: {
            canvasInputMode: 'trackpad',
          },
        },
      )

      const readSpaceAndNode = async (): Promise<{
        rectX: number
        rectY: number
        rectWidth: number
        rectHeight: number
        nodeX: number
        nodeY: number
      } | null> => {
        return await window.evaluate(
          async ({ key, spaceId, nodeId }) => {
            void key

            const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
            if (!raw) {
              return null
            }

            const parsed = JSON.parse(raw) as {
              workspaces?: Array<{
                nodes?: Array<{
                  id?: string
                  position?: { x?: number; y?: number }
                }>
                spaces?: Array<{
                  id?: string
                  rect?: { x?: number; y?: number; width?: number; height?: number } | null
                }>
              }>
            }

            const workspace = parsed.workspaces?.[0]
            const node = workspace?.nodes?.find(item => item.id === nodeId)
            const space = workspace?.spaces?.find(item => item.id === spaceId)

            if (
              !node?.position ||
              typeof node.position.x !== 'number' ||
              typeof node.position.y !== 'number' ||
              !space?.rect ||
              typeof space.rect.x !== 'number' ||
              typeof space.rect.y !== 'number' ||
              typeof space.rect.width !== 'number' ||
              typeof space.rect.height !== 'number'
            ) {
              return null
            }

            return {
              rectX: space.rect.x,
              rectY: space.rect.y,
              rectWidth: space.rect.width,
              rectHeight: space.rect.height,
              nodeX: node.position.x,
              nodeY: node.position.y,
            }
          },
          {
            key: storageKey,
            spaceId: 'marquee-drag-space',
            nodeId: 'marquee-drag-space-node',
          },
        )
      }

      const before = await readSpaceAndNode()
      if (!before) {
        throw new Error('failed to read initial persisted space/node state')
      }

      const pane = window.locator('.workspace-canvas .react-flow__pane')
      await expect(pane).toBeVisible()

      const spaceRegion = window.locator('.workspace-space-region').first()
      await expect(spaceRegion).toBeVisible()
      const paneBox = await pane.boundingBox()
      const spaceBox = await spaceRegion.boundingBox()
      if (!paneBox || !spaceBox) {
        throw new Error('workspace pane/space bounding box unavailable')
      }

      const selectionStartX = paneBox.x + 40
      const selectionStartY = paneBox.y + 40
      const selectionEndX = Math.min(
        paneBox.x + paneBox.width - 24,
        spaceBox.x + spaceBox.width * 0.35,
      )
      const selectionEndY = Math.min(
        paneBox.y + paneBox.height - 24,
        spaceBox.y + spaceBox.height * 0.35,
      )

      await window.mouse.move(selectionStartX, selectionStartY)
      await window.mouse.down()
      await window.mouse.move(selectionEndX, selectionEndY, { steps: 10 })
      await window.mouse.up()

      const selectedTopHandle = window.locator(
        '[data-testid="workspace-space-drag-marquee-drag-space-top"]',
      )
      await expect(selectedTopHandle).toBeVisible()
      const handleBox = await selectedTopHandle.boundingBox()
      if (!handleBox) {
        throw new Error('selected space top handle bounding box unavailable')
      }

      const dragStartX = handleBox.x + handleBox.width * 0.75
      const dragStartY = handleBox.y + handleBox.height * 0.5
      const dragDx = 180
      const dragDy = 120

      await window.mouse.move(dragStartX, dragStartY)
      await window.mouse.down()
      await window.mouse.move(dragStartX + dragDx, dragStartY + dragDy, { steps: 12 })
      await window.mouse.up()

      await expect
        .poll(async () => {
          const after = await readSpaceAndNode()
          if (!after) {
            return null
          }

          return {
            rectDx: after.rectX - before.rectX,
            rectDy: after.rectY - before.rectY,
            rectDw: after.rectWidth - before.rectWidth,
            rectDh: after.rectHeight - before.rectHeight,
            nodeDx: after.nodeX - before.nodeX,
            nodeDy: after.nodeY - before.nodeY,
          }
        })
        .toEqual(
          expect.objectContaining({
            rectDx: expect.any(Number),
            rectDy: expect.any(Number),
            rectDw: 0,
            rectDh: 0,
            nodeDx: expect.any(Number),
            nodeDy: expect.any(Number),
          }),
        )

      await expect
        .poll(async () => {
          const after = await readSpaceAndNode()
          return after ? after.rectX - before.rectX : Number.NaN
        })
        .toBeGreaterThan(120)

      await expect
        .poll(async () => {
          const after = await readSpaceAndNode()
          return after ? after.rectY - before.rectY : Number.NaN
        })
        .toBeGreaterThan(80)
    } finally {
      await electronApp.close()
    }
  })

  test('resizes selected space from edge hitbox', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'marquee-drag-space-edge-node',
            title: 'terminal-marquee-drag-space-edge',
            position: { x: 220, y: 180 },
            width: 240,
            height: 160,
          },
        ],
        {
          spaces: [
            {
              id: 'marquee-drag-space-edge',
              name: 'Drag Selected Edge',
              directoryPath: testWorkspacePath,
              nodeIds: ['marquee-drag-space-edge-node'],
              rect: { x: 200, y: 160, width: 540, height: 380 },
            },
          ],
          activeSpaceId: null,
          settings: {
            canvasInputMode: 'trackpad',
          },
        },
      )

      const readSpaceAndNode = async (): Promise<{
        rectX: number
        rectY: number
        rectWidth: number
        rectHeight: number
        nodeX: number
        nodeY: number
      } | null> => {
        return await window.evaluate(
          async ({ key, spaceId, nodeId }) => {
            void key

            const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
            if (!raw) {
              return null
            }

            const parsed = JSON.parse(raw) as {
              workspaces?: Array<{
                nodes?: Array<{
                  id?: string
                  position?: { x?: number; y?: number }
                }>
                spaces?: Array<{
                  id?: string
                  rect?: { x?: number; y?: number; width?: number; height?: number } | null
                }>
              }>
            }

            const workspace = parsed.workspaces?.[0]
            const node = workspace?.nodes?.find(item => item.id === nodeId)
            const space = workspace?.spaces?.find(item => item.id === spaceId)

            if (
              !node?.position ||
              typeof node.position.x !== 'number' ||
              typeof node.position.y !== 'number' ||
              !space?.rect ||
              typeof space.rect.x !== 'number' ||
              typeof space.rect.y !== 'number' ||
              typeof space.rect.width !== 'number' ||
              typeof space.rect.height !== 'number'
            ) {
              return null
            }

            return {
              rectX: space.rect.x,
              rectY: space.rect.y,
              rectWidth: space.rect.width,
              rectHeight: space.rect.height,
              nodeX: node.position.x,
              nodeY: node.position.y,
            }
          },
          {
            key: storageKey,
            spaceId: 'marquee-drag-space-edge',
            nodeId: 'marquee-drag-space-edge-node',
          },
        )
      }

      const before = await readSpaceAndNode()
      if (!before) {
        throw new Error('failed to read initial persisted space/node state')
      }

      const pane = window.locator('.workspace-canvas .react-flow__pane')
      await expect(pane).toBeVisible()

      const spaceRegion = window.locator('.workspace-space-region').first()
      await expect(spaceRegion).toBeVisible()
      const paneBox = await pane.boundingBox()
      const spaceBox = await spaceRegion.boundingBox()
      if (!paneBox || !spaceBox) {
        throw new Error('workspace pane/space bounding box unavailable')
      }

      const selectionStartX = paneBox.x + 40
      const selectionStartY = paneBox.y + 40
      const selectionEndX = Math.min(
        paneBox.x + paneBox.width - 24,
        spaceBox.x + spaceBox.width * 0.35,
      )
      const selectionEndY = Math.min(
        paneBox.y + paneBox.height - 24,
        spaceBox.y + spaceBox.height * 0.35,
      )

      await window.mouse.move(selectionStartX, selectionStartY)
      await window.mouse.down()
      await window.mouse.move(selectionEndX, selectionEndY, { steps: 10 })
      await window.mouse.up()

      const selectedSpace = window.locator('.workspace-space-region--selected').first()
      await expect(selectedSpace).toBeVisible()
      const selectedBox = await selectedSpace.boundingBox()
      if (!selectedBox) {
        throw new Error('selected space bounding box unavailable')
      }

      const dragStartX = selectedBox.x + selectedBox.width - 2
      const dragStartY = selectedBox.y + selectedBox.height * 0.5
      const dragDx = 180
      const dragDy = 120

      await window.mouse.move(dragStartX, dragStartY)
      await window.mouse.down()
      await window.mouse.move(dragStartX + dragDx, dragStartY + dragDy, { steps: 12 })
      await window.mouse.up()

      await expect
        .poll(async () => {
          const after = await readSpaceAndNode()
          if (!after) {
            return null
          }

          return {
            rectDx: after.rectX - before.rectX,
            rectDy: after.rectY - before.rectY,
            rectDw: after.rectWidth - before.rectWidth,
            rectDh: after.rectHeight - before.rectHeight,
            nodeDx: after.nodeX - before.nodeX,
            nodeDy: after.nodeY - before.nodeY,
          }
        })
        .toEqual(
          expect.objectContaining({
            rectDx: 0,
            rectDy: 0,
            rectDw: expect.any(Number),
            rectDh: 0,
            nodeDx: 0,
            nodeDy: 0,
          }),
        )

      await expect
        .poll(async () => {
          const after = await readSpaceAndNode()
          return after ? after.rectWidth - before.rectWidth : Number.NaN
        })
        .toBeGreaterThan(120)

      await expect
        .poll(async () => {
          const after = await readSpaceAndNode()
          return after ? after.nodeX - before.nodeX : Number.NaN
        })
        .toBe(0)
    } finally {
      await electronApp.close()
    }
  })
})
