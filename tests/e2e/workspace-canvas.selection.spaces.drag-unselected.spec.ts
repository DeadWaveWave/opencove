import { expect, test } from '@playwright/test'
import {
  clearAndSeedWorkspace,
  launchApp,
  storageKey,
  testWorkspacePath,
} from './workspace-canvas.helpers'

test.describe('Workspace Canvas - Selection (Spaces)', () => {
  test('does not move selected space when dragging a node', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'drag-guard-inside-space-node',
            title: 'terminal-drag-guard-inside',
            position: { x: 240, y: 200 },
            width: 460,
            height: 300,
          },
        ],
        {
          spaces: [
            {
              id: 'drag-guard-space',
              name: 'Drag Guard Space',
              directoryPath: testWorkspacePath,
              nodeIds: ['drag-guard-inside-space-node'],
              rect: { x: 200, y: 160, width: 700, height: 500 },
            },
          ],
          activeSpaceId: null,
          settings: {
            canvasInputMode: 'trackpad',
          },
        },
      )

      const readState = async (): Promise<{
        spaceX: number
        spaceY: number
        spaceWidth: number
        spaceHeight: number
        insideX: number
        insideY: number
      } | null> => {
        return await window.evaluate(
          async ({ key, spaceId, insideId }) => {
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
            const inside = workspace?.nodes?.find(node => node.id === insideId)
            const space = workspace?.spaces?.find(entry => entry.id === spaceId)

            if (
              !inside?.position ||
              typeof inside.position.x !== 'number' ||
              typeof inside.position.y !== 'number' ||
              !space?.rect ||
              typeof space.rect.x !== 'number' ||
              typeof space.rect.y !== 'number' ||
              typeof space.rect.width !== 'number' ||
              typeof space.rect.height !== 'number'
            ) {
              return null
            }

            return {
              spaceX: space.rect.x,
              spaceY: space.rect.y,
              spaceWidth: space.rect.width,
              spaceHeight: space.rect.height,
              insideX: inside.position.x,
              insideY: inside.position.y,
            }
          },
          {
            key: storageKey,
            spaceId: 'drag-guard-space',
            insideId: 'drag-guard-inside-space-node',
          },
        )
      }

      const before = await readState()
      if (!before) {
        throw new Error('failed to read initial drag-guard state')
      }

      const pane = window.locator('.workspace-canvas .react-flow__pane')
      await expect(pane).toBeVisible()

      const selectedTopHandle = window.locator(
        '[data-testid="workspace-space-drag-drag-guard-space-top"]',
      )
      await expect(selectedTopHandle).toBeVisible()
      await selectedTopHandle.click()

      await expect(window.locator('.workspace-space-region--selected')).toHaveCount(1)

      const insideNode = window
        .locator('.terminal-node')
        .filter({ hasText: 'terminal-drag-guard-inside' })
        .first()
      await expect(insideNode).toBeVisible()

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
          const after = await readState()
          return after ? after.insideX - before.insideX : Number.NaN
        })
        .toBeGreaterThan(120)

      await expect
        .poll(async () => {
          const after = await readState()
          return after ? after.insideY - before.insideY : Number.NaN
        })
        .toBeGreaterThan(80)

      const after = await readState()
      if (!after) {
        throw new Error('failed to read post-drag drag-guard state')
      }

      expect(Math.abs(after.spaceX - before.spaceX)).toBeLessThan(1)
      expect(Math.abs(after.spaceY - before.spaceY)).toBeLessThan(1)
      expect(Math.abs(after.spaceWidth - before.spaceWidth)).toBeLessThan(1)
      expect(Math.abs(after.spaceHeight - before.spaceHeight)).toBeLessThan(1)
    } finally {
      await electronApp.close()
    }
  })
})
