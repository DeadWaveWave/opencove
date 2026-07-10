import { expect, test, type Page } from '@playwright/test'
import {
  clearAndSeedWorkspace,
  launchApp,
  readLocatorClientRect,
  testWorkspacePath,
} from './workspace-canvas.helpers'

async function readSpaceNodeIds(window: Page, spaceId: string): Promise<string[] | null> {
  return await window.evaluate(async id => {
    const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
    if (!raw) {
      return null
    }

    const state = JSON.parse(raw) as {
      workspaces?: Array<{
        spaces?: Array<{
          id?: string
          nodeIds?: string[]
        }>
      }>
    }

    const space = state.workspaces?.[0]?.spaces?.find(entry => entry.id === id)
    return Array.isArray(space?.nodeIds) ? space.nodeIds : null
  }, spaceId)
}

async function readNodePosition(
  window: Page,
  nodeId: string,
): Promise<{ x: number; y: number } | null> {
  return await window.evaluate(async id => {
    const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
    if (!raw) {
      return null
    }

    const state = JSON.parse(raw) as {
      workspaces?: Array<{
        nodes?: Array<{
          id?: string
          position?: { x?: number; y?: number }
        }>
      }>
    }
    const position = state.workspaces?.[0]?.nodes?.find(entry => entry.id === id)?.position
    return typeof position?.x === 'number' && typeof position.y === 'number'
      ? { x: position.x, y: position.y }
      : null
  }, nodeId)
}

test.describe('Workspace Canvas - Spaces (Edge Drag Smoothness)', () => {
  test('keeps a root window stable while slowly dragging along a space edge', async () => {
    const { electronApp, window } = await launchApp()
    let mouseIsDown = false

    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'edge-drag-root-note',
            title: 'edge-drag-root-note',
            position: { x: 160, y: 260 },
            width: 280,
            height: 180,
            kind: 'note',
            task: { text: 'edge drag root note' },
          },
        ],
        {
          settings: { canvasInputMode: 'mouse' },
          spaces: [
            {
              id: 'edge-drag-space',
              name: 'Edge Drag Space',
              directoryPath: testWorkspacePath,
              nodeIds: [],
              rect: { x: 520, y: 180, width: 620, height: 520 },
            },
          ],
          activeSpaceId: null,
        },
      )

      const rootNode = window
        .locator('.note-node')
        .filter({ hasText: 'edge drag root note' })
        .first()
      const dragSurface = rootNode.getByTestId('note-node-header-drag-surface')
      const spaceRegion = window
        .locator('.workspace-space-region')
        .filter({ hasText: 'Edge Drag Space' })
        .first()

      const rootBox = await readLocatorClientRect(rootNode)
      const dragSurfaceBox = await readLocatorClientRect(dragSurface)
      const spaceBox = await readLocatorClientRect(spaceRegion)
      const start = {
        x: dragSurfaceBox.x + dragSurfaceBox.width / 2,
        y: dragSurfaceBox.y + dragSurfaceBox.height / 2,
      }
      const edgePointerX = spaceBox.x - 8
      const edgePointerStartY = start.y

      expect(rootBox.x + rootBox.width).toBeLessThan(spaceBox.x)
      expect(edgePointerX).toBeLessThan(spaceBox.x)

      await window.mouse.move(start.x, start.y)
      await window.mouse.down()
      mouseIsDown = true
      await window.waitForTimeout(16)

      // Trigger the drag first, then use a single large move to reach the exact edge position.
      // The following small moves verify that every coalesced live frame preserves that position.
      await window.mouse.move(start.x + 8, start.y)
      await window.waitForTimeout(24)
      await window.mouse.move(edgePointerX, edgePointerStartY)
      await window.waitForTimeout(40)

      const edgeBaseline = await readLocatorClientRect(rootNode)
      expect(edgeBaseline.x + edgeBaseline.width).toBeLessThanOrEqual(spaceBox.x + 2)

      const samples = [edgeBaseline]
      for (let step = 1; step <= 12; step += 1) {
        // eslint-disable-next-line no-await-in-loop -- sequential moves model adjacent drag frames
        await window.mouse.move(edgePointerX, edgePointerStartY + step * 3)
        // eslint-disable-next-line no-await-in-loop -- each sample must observe the preceding move
        await window.waitForTimeout(24)

        // eslint-disable-next-line no-await-in-loop -- geometry order is the regression assertion
        const sample = await readLocatorClientRect(rootNode)
        const previous = samples[samples.length - 1]
        samples.push(sample)

        expect(sample.x + sample.width).toBeLessThanOrEqual(spaceBox.x + 2)
        expect(Math.abs(sample.x - edgeBaseline.x)).toBeLessThanOrEqual(2)
        expect(sample.y).toBeGreaterThanOrEqual(previous.y - 1)
      }

      expect(samples[samples.length - 1].y - edgeBaseline.y).toBeGreaterThan(24)

      await window.mouse.up()
      mouseIsDown = false

      await expect.poll(async () => await readSpaceNodeIds(window, 'edge-drag-space')).toEqual([])
      await expect
        .poll(async () => {
          const position = await readNodePosition(window, 'edge-drag-root-note')
          return position
            ? {
                stayedOutside: position.x + 280 <= 522,
                movedHorizontally: position.x > 200,
                movedVertically: position.y > 284,
              }
            : null
        })
        .toEqual({
          stayedOutside: true,
          movedHorizontally: true,
          movedVertically: true,
        })
    } finally {
      if (mouseIsDown) {
        await window.mouse.up().catch(() => undefined)
      }
      await electronApp.close()
    }
  })
})
