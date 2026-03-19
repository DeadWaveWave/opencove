import { expect, test } from '@playwright/test'
import {
  clearAndSeedWorkspace,
  launchApp,
  storageKey,
  testWorkspacePath,
} from './workspace-canvas.helpers'

test.describe('Workspace Canvas - Selection (Spaces)', () => {
  test('does not drag out-of-scope nodes after crossing a space boundary', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'marquee-boundary-inside-space-node',
            title: 'terminal-marquee-boundary-inside',
            position: { x: 240, y: 200 },
            width: 460,
            height: 300,
          },
          {
            id: 'marquee-boundary-outside-space-node',
            title: 'terminal-marquee-boundary-outside',
            position: { x: 940, y: 200 },
            width: 460,
            height: 300,
          },
        ],
        {
          spaces: [
            {
              id: 'marquee-boundary-start-space',
              name: 'Boundary Scope',
              directoryPath: testWorkspacePath,
              nodeIds: ['marquee-boundary-inside-space-node'],
              rect: { x: 200, y: 160, width: 700, height: 500 },
            },
          ],
          activeSpaceId: null,
          settings: {
            canvasInputMode: 'trackpad',
          },
        },
      )

      const readNodePositions = async (): Promise<{
        insideX: number
        insideY: number
        outsideX: number
        outsideY: number
      } | null> => {
        return await window.evaluate(
          async ({ key, insideId, outsideId }) => {
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
              }>
            }

            const workspace = parsed.workspaces?.[0]
            const inside = workspace?.nodes?.find(node => node.id === insideId)
            const outside = workspace?.nodes?.find(node => node.id === outsideId)

            if (
              !inside?.position ||
              typeof inside.position.x !== 'number' ||
              typeof inside.position.y !== 'number' ||
              !outside?.position ||
              typeof outside.position.x !== 'number' ||
              typeof outside.position.y !== 'number'
            ) {
              return null
            }

            return {
              insideX: inside.position.x,
              insideY: inside.position.y,
              outsideX: outside.position.x,
              outsideY: outside.position.y,
            }
          },
          {
            key: storageKey,
            insideId: 'marquee-boundary-inside-space-node',
            outsideId: 'marquee-boundary-outside-space-node',
          },
        )
      }

      const before = await readNodePositions()
      if (!before) {
        throw new Error('failed to read initial node positions')
      }

      const pane = window.locator('.workspace-canvas .react-flow__pane')
      await expect(pane).toBeVisible()

      const spaceRegion = window.locator('.workspace-space-region').first()
      await expect(spaceRegion).toBeVisible()

      const insideNode = window
        .locator('.terminal-node')
        .filter({ hasText: 'terminal-marquee-boundary-inside' })
        .first()
      const outsideNode = window
        .locator('.terminal-node')
        .filter({ hasText: 'terminal-marquee-boundary-outside' })
        .first()
      await expect(insideNode).toBeVisible()
      await expect(outsideNode).toBeVisible()

      const spaceBox = await spaceRegion.boundingBox()
      const outsideBox = await outsideNode.boundingBox()
      if (!spaceBox || !outsideBox) {
        throw new Error('space/outside node bounding box unavailable')
      }

      const selectionStartX = spaceBox.x + 20
      const selectionStartY = spaceBox.y + 20
      const selectionEndX = outsideBox.x + outsideBox.width * 0.8
      const selectionEndY = outsideBox.y + outsideBox.height * 0.8

      await window.mouse.move(selectionStartX, selectionStartY)
      await window.mouse.down()
      await window.mouse.move(selectionEndX, selectionEndY, { steps: 12 })
      await window.mouse.up()

      await expect(window.locator('.react-flow__node.selected')).toHaveCount(1)
      await expect(
        window.locator('.react-flow__node.selected .terminal-node__title'),
      ).toContainText('terminal-marquee-boundary-inside')

      const insideHeader = insideNode.locator('.terminal-node__header')
      await expect(insideHeader).toBeVisible()
      const insideHeaderBox = await insideHeader.boundingBox()
      if (!insideHeaderBox) {
        throw new Error('inside node header bounding box unavailable')
      }

      const dragStartX = insideHeaderBox.x + insideHeaderBox.width * 0.5
      const dragStartY = insideHeaderBox.y + insideHeaderBox.height * 0.5
      const dragDx = 180
      const dragDy = 120

      await window.mouse.move(dragStartX, dragStartY)
      await window.mouse.down()
      await window.mouse.move(dragStartX + dragDx, dragStartY + dragDy, { steps: 12 })
      await window.mouse.up()

      await expect
        .poll(async () => {
          const after = await readNodePositions()
          return after ? after.insideX - before.insideX : Number.NaN
        })
        .toBeGreaterThan(120)

      await expect
        .poll(async () => {
          const after = await readNodePositions()
          return after ? after.insideY - before.insideY : Number.NaN
        })
        .toBeGreaterThan(80)

      await expect
        .poll(async () => {
          const after = await readNodePositions()
          return after ? Math.abs(after.outsideX - before.outsideX) : Number.NaN
        })
        .toBeLessThan(1)

      await expect
        .poll(async () => {
          const after = await readNodePositions()
          return after ? Math.abs(after.outsideY - before.outsideY) : Number.NaN
        })
        .toBeLessThan(1)
    } finally {
      await electronApp.close()
    }
  })

  test('drags a selected space together with selected outside windows', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'marquee-space-mixed-inside-node',
            title: 'terminal-marquee-mixed-inside',
            position: { x: 240, y: 200 },
            width: 460,
            height: 300,
          },
          {
            id: 'marquee-space-mixed-outside-node',
            title: 'terminal-marquee-mixed-outside',
            position: { x: 940, y: 200 },
            width: 460,
            height: 300,
          },
        ],
        {
          spaces: [
            {
              id: 'marquee-mixed-space',
              name: 'Mixed Drag',
              directoryPath: testWorkspacePath,
              nodeIds: ['marquee-space-mixed-inside-node'],
              rect: { x: 200, y: 160, width: 700, height: 500 },
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
      const paneBox = await pane.boundingBox()
      if (!paneBox) {
        throw new Error('workspace pane bounding box unavailable')
      }

      const spaceRegion = window.locator('.workspace-space-region').first()
      await expect(spaceRegion).toBeVisible()

      const outsideNode = window
        .locator('.terminal-node')
        .filter({ hasText: 'terminal-marquee-mixed-outside' })
        .first()
      await expect(outsideNode).toBeVisible()

      const outsideBox = await outsideNode.boundingBox()
      if (!outsideBox) {
        throw new Error('outside node bounding box unavailable')
      }

      const spaceBox = await spaceRegion.boundingBox()
      if (!spaceBox) {
        throw new Error('space bounding box unavailable')
      }

      const marqueeStartX = Math.max(paneBox.x + 20, spaceBox.x - 30)
      const marqueeStartY = Math.max(paneBox.y + 20, spaceBox.y + 20)
      const marqueeEndX = outsideBox.x + outsideBox.width * 0.75
      const marqueeEndY = outsideBox.y + outsideBox.height * 0.75

      await window.mouse.move(marqueeStartX, marqueeStartY)
      await window.mouse.down()
      await window.mouse.move(marqueeEndX, marqueeEndY, { steps: 12 })
      await window.mouse.up()

      await expect(window.locator('.workspace-space-region--selected')).toHaveCount(1)
      await expect(window.locator('.react-flow__node.selected')).toHaveCount(1)
      await expect(
        window.locator('.react-flow__node.selected .terminal-node__title'),
      ).toContainText('terminal-marquee-mixed-outside')

      const readState = async (): Promise<{
        spaceX: number
        spaceY: number
        insideX: number
        insideY: number
        outsideX: number
        outsideY: number
      } | null> => {
        return await window.evaluate(
          async ({ key, spaceId, insideId, outsideId }) => {
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
                  rect?: { x?: number; y?: number } | null
                }>
              }>
            }

            const workspace = parsed.workspaces?.[0]
            const inside = workspace?.nodes?.find(node => node.id === insideId)
            const outside = workspace?.nodes?.find(node => node.id === outsideId)
            const space = workspace?.spaces?.find(entry => entry.id === spaceId)

            if (
              !inside?.position ||
              typeof inside.position.x !== 'number' ||
              typeof inside.position.y !== 'number' ||
              !outside?.position ||
              typeof outside.position.x !== 'number' ||
              typeof outside.position.y !== 'number' ||
              !space?.rect ||
              typeof space.rect.x !== 'number' ||
              typeof space.rect.y !== 'number'
            ) {
              return null
            }

            return {
              spaceX: space.rect.x,
              spaceY: space.rect.y,
              insideX: inside.position.x,
              insideY: inside.position.y,
              outsideX: outside.position.x,
              outsideY: outside.position.y,
            }
          },
          {
            key: storageKey,
            spaceId: 'marquee-mixed-space',
            insideId: 'marquee-space-mixed-inside-node',
            outsideId: 'marquee-space-mixed-outside-node',
          },
        )
      }

      const before = await readState()
      if (!before) {
        throw new Error('failed to read initial mixed selection state')
      }

      const selectedSpace = window.locator('.workspace-space-region--selected').first()
      const selectedTopHandle = selectedSpace.locator('.workspace-space-region__drag-handle--top')
      const topHandleBox = await selectedTopHandle.boundingBox()
      if (!topHandleBox) {
        throw new Error('selected space top handle bounding box unavailable')
      }

      const dragStartX = topHandleBox.x + topHandleBox.width / 2
      const dragStartY = topHandleBox.y + topHandleBox.height / 2
      const dragDx = 180
      const dragDy = 120

      await window.mouse.move(dragStartX, dragStartY)
      await window.mouse.down()
      await window.mouse.move(dragStartX + dragDx, dragStartY + dragDy, { steps: 12 })
      await window.mouse.up()

      await expect
        .poll(async () => {
          const after = await readState()
          return after ? after.spaceX - before.spaceX : Number.NaN
        })
        .toBeGreaterThan(120)

      await expect
        .poll(async () => {
          const after = await readState()
          return after ? after.insideX - before.insideX : Number.NaN
        })
        .toBeGreaterThan(120)

      await expect
        .poll(async () => {
          const after = await readState()
          return after ? after.outsideX - before.outsideX : Number.NaN
        })
        .toBeGreaterThan(120)
    } finally {
      await electronApp.close()
    }
  })
})
