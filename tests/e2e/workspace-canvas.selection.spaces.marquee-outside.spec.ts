import { expect, test } from '@playwright/test'
import {
  beginDragMouse,
  clearAndSeedWorkspace,
  dragMouse,
  launchApp,
  readCanvasViewport,
  readLocatorClientRect,
  storageKey,
  testWorkspacePath,
} from './workspace-canvas.helpers'

test.describe('Workspace Canvas - Selection (Spaces)', () => {
  test('selects space (not enclosed nodes) when marquee starts outside space', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'marquee-space-node',
            title: 'terminal-marquee-in-space',
            position: { x: 240, y: 200 },
            width: 460,
            height: 300,
          },
        ],
        {
          spaces: [
            {
              id: 'marquee-space',
              name: 'Marquee Scope',
              directoryPath: testWorkspacePath,
              nodeIds: ['marquee-space-node'],
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

      const paneBox = await readLocatorClientRect(pane)
      const spaceBox = await readLocatorClientRect(spaceRegion)

      const startX = paneBox.x + 40
      const startY = paneBox.y + 40
      const endX = Math.min(paneBox.x + paneBox.width - 24, spaceBox.x + spaceBox.width * 0.35)
      const endY = Math.min(paneBox.y + paneBox.height - 24, spaceBox.y + spaceBox.height * 0.35)

      const drag = await beginDragMouse(window, {
        start: { x: startX, y: startY },
        initialTarget: { x: endX, y: endY },
        steps: 10,
        settleAfterPressMs: 64,
        settleBeforeReleaseMs: 96,
        settleAfterReleaseMs: 64,
      })
      await drag.moveTo({ x: endX, y: endY }, { settleAfterMoveMs: 48 })

      await expect(window.locator('.workspace-space-region--selected')).toHaveCount(1)
      await expect(window.locator('.react-flow__node.selected')).toHaveCount(0)

      await drag.release()

      await expect(window.locator('.workspace-space-region--selected')).toHaveCount(1)
      await expect(window.locator('.react-flow__node.selected')).toHaveCount(0)
    } finally {
      await electronApp.close()
    }
  })

  test('does not select nodes visually inside a touched space even when not owned', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'marquee-space-owned-node',
            title: 'terminal-marquee-owned',
            position: { x: 240, y: 200 },
            width: 460,
            height: 300,
          },
          {
            id: 'marquee-space-unowned-node',
            title: 'terminal-marquee-unowned',
            position: { x: 520, y: 240 },
            width: 460,
            height: 300,
          },
        ],
        {
          spaces: [
            {
              id: 'marquee-space-unowned-scope',
              name: 'Unowned Scope',
              directoryPath: testWorkspacePath,
              nodeIds: ['marquee-space-owned-node'],
              rect: { x: 200, y: 160, width: 900, height: 460 },
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

      const paneBox = await readLocatorClientRect(pane)
      const spaceBox = await readLocatorClientRect(spaceRegion)

      const startX = paneBox.x + 40
      const startY = paneBox.y + 40
      const endX = Math.min(paneBox.x + paneBox.width - 24, spaceBox.x + spaceBox.width * 0.35)
      const endY = Math.min(paneBox.y + paneBox.height - 24, spaceBox.y + spaceBox.height * 0.35)

      const drag = await beginDragMouse(window, {
        start: { x: startX, y: startY },
        initialTarget: { x: endX, y: endY },
        steps: 10,
        settleAfterPressMs: 64,
        settleBeforeReleaseMs: 96,
        settleAfterReleaseMs: 64,
      })
      await drag.moveTo({ x: endX, y: endY }, { settleAfterMoveMs: 48 })

      await expect(window.locator('.workspace-space-region--selected')).toHaveCount(1)
      await expect(window.locator('.react-flow__node.selected')).toHaveCount(0)

      await drag.release()

      await expect(window.locator('.workspace-space-region--selected')).toHaveCount(1)
      await expect(window.locator('.react-flow__node.selected')).toHaveCount(0)
    } finally {
      await electronApp.close()
    }
  })

  test.skip('keeps outside windows stable when marquee selects a space', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'marquee-outside-node',
            title: 'terminal-marquee-outside',
            position: { x: 120, y: 220 },
            width: 460,
            height: 300,
          },
          {
            id: 'marquee-space-inside-node',
            title: 'terminal-marquee-space-inside',
            position: { x: 840, y: 240 },
            width: 460,
            height: 300,
          },
        ],
        {
          spaces: [
            {
              id: 'marquee-space-keep-outside',
              name: 'Keep Outside',
              directoryPath: testWorkspacePath,
              nodeIds: ['marquee-space-inside-node'],
              rect: { x: 800, y: 200, width: 540, height: 380 },
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

      const outsideNode = window
        .locator('.terminal-node')
        .filter({ hasText: 'terminal-marquee-outside' })
        .first()
      await expect(outsideNode).toBeVisible()

      const spaceRegion = window.locator('.workspace-space-region').first()
      await expect(spaceRegion).toBeVisible()

      const paneBox = await readLocatorClientRect(pane)
      await expect(spaceRegion).toBeVisible()
      const viewport = await readCanvasViewport(window)
      const toClientPoint = (point: { x: number; y: number }): { x: number; y: number } => ({
        x: paneBox.x + viewport.x + point.x * viewport.zoom,
        y: paneBox.y + viewport.y + point.y * viewport.zoom,
      })
      const start = toClientPoint({ x: 80, y: 180 })
      const mid = toClientPoint({ x: 520, y: 520 })
      const end = toClientPoint({ x: 990, y: 360 })

      const drag = await beginDragMouse(window, {
        start,
        initialTarget: mid,
        steps: 10,
      })
      await drag.moveTo(mid, { settleAfterMoveMs: 48 })

      await drag.moveTo(end, { steps: 12, settleAfterMoveMs: 48 })

      await expect(window.locator('.workspace-space-region--selected')).toHaveCount(1)

      await drag.release()

      await expect(window.locator('.workspace-space-region--selected')).toHaveCount(1)
      const selectedNodeCount = await window.locator('.react-flow__node.selected').count()

      const readNodePositions = async (): Promise<{
        outsideX: number
        outsideY: number
        insideX: number
        insideY: number
        spaceX: number
        spaceY: number
      } | null> => {
        return await window.evaluate(
          async ({ key, outsideId, insideId, spaceId }) => {
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
            const outside = workspace?.nodes?.find(node => node.id === outsideId)
            const inside = workspace?.nodes?.find(node => node.id === insideId)
            const space = workspace?.spaces?.find(entry => entry.id === spaceId)

            if (
              !outside?.position ||
              typeof outside.position.x !== 'number' ||
              typeof outside.position.y !== 'number' ||
              !inside?.position ||
              typeof inside.position.x !== 'number' ||
              typeof inside.position.y !== 'number' ||
              !space?.rect ||
              typeof space.rect.x !== 'number' ||
              typeof space.rect.y !== 'number'
            ) {
              return null
            }

            return {
              outsideX: outside.position.x,
              outsideY: outside.position.y,
              insideX: inside.position.x,
              insideY: inside.position.y,
              spaceX: space.rect.x,
              spaceY: space.rect.y,
            }
          },
          {
            key: storageKey,
            outsideId: 'marquee-outside-node',
            insideId: 'marquee-space-inside-node',
            spaceId: 'marquee-space-keep-outside',
          },
        )
      }

      const beforeDrag = await readNodePositions()
      if (!beforeDrag) {
        throw new Error('failed to read node positions after marquee selection')
      }

      const selectedSpaceTopHandle = window.locator(
        '[data-testid="workspace-space-drag-marquee-space-keep-outside-top"]',
      )
      await expect(selectedSpaceTopHandle).toBeVisible()
      const selectedSpaceTopHandleBox = await readLocatorClientRect(selectedSpaceTopHandle)

      const dragStartX = selectedSpaceTopHandleBox.x + selectedSpaceTopHandleBox.width * 0.75
      const dragStartY = selectedSpaceTopHandleBox.y + selectedSpaceTopHandleBox.height * 0.5
      const dragEndX = dragStartX
      const dragEndY = dragStartY + 180

      await dragMouse(window, {
        start: { x: dragStartX, y: dragStartY },
        end: { x: dragEndX, y: dragEndY },
        steps: 12,
        settleAfterPressMs: 64,
        settleBeforeReleaseMs: 96,
        settleAfterReleaseMs: 64,
      })

      const readOutsideYDelta = async (): Promise<number> => {
        const after = await readNodePositions()
        return after ? after.outsideY - beforeDrag.outsideY : Number.NaN
      }

      if (selectedNodeCount > 0) {
        await expect.poll(readOutsideYDelta).toBeGreaterThan(120)
      } else {
        await expect.poll(readOutsideYDelta).toBeLessThanOrEqual(10)
      }

      await expect
        .poll(async () => {
          const after = await readNodePositions()
          return after ? after.spaceY - beforeDrag.spaceY : Number.NaN
        })
        .toBeGreaterThan(120)

      await expect
        .poll(async () => {
          const after = await readNodePositions()
          return after ? Math.abs(after.spaceX - beforeDrag.spaceX) : Number.NaN
        })
        .toBeLessThanOrEqual(10)

      await expect
        .poll(async () => {
          const after = await readNodePositions()
          return after ? after.insideY - beforeDrag.insideY : Number.NaN
        })
        .toBeGreaterThan(120)

      await expect
        .poll(async () => {
          const after = await readNodePositions()
          return after ? Math.abs(after.insideX - beforeDrag.insideX) : Number.NaN
        })
        .toBeLessThanOrEqual(10)
    } finally {
      await electronApp.close()
    }
  })
})
