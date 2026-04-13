import { expect, test } from '@playwright/test'
import {
  clearAndSeedWorkspace,
  dragMouse,
  launchApp,
  readLocatorClientRect,
  storageKey,
  testWorkspacePath,
} from './workspace-canvas.helpers'

test.describe('Workspace Canvas - Selection (Spaces)', () => {
  test('pushes away other spaces when dragging a node with a selected space', async () => {
    test.slow()
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
              rect: { x: 720, y: 160, width: 500, height: 400 },
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
      const outsideTitle = outsideNode.locator('.terminal-node__title').first()
      await expect(outsideHeader).toBeVisible()
      await expect(outsideTitle).toBeVisible()

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
      await window.waitForTimeout(150)

      const readState = async (): Promise<{
        spaceAX: number
        spaceAY: number
        spaceAWidth: number
        spaceAHeight: number
        spaceBX: number
        spaceBY: number
        spaceBWidth: number
        spaceBHeight: number
      } | null> => {
        const evaluation = window
          .evaluate(
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
                    rect?: { x?: number; y?: number; width?: number; height?: number } | null
                  }>
                }>
              }

              const workspace = parsed.workspaces?.[0]
              const spaceA = workspace?.spaces?.find(entry => entry.id === spaceAId)
              const spaceB = workspace?.spaces?.find(entry => entry.id === spaceBId)

              if (
                !spaceA?.rect ||
                typeof spaceA.rect.x !== 'number' ||
                typeof spaceA.rect.y !== 'number' ||
                typeof spaceA.rect.width !== 'number' ||
                typeof spaceA.rect.height !== 'number' ||
                !spaceB?.rect ||
                typeof spaceB.rect.x !== 'number' ||
                typeof spaceB.rect.y !== 'number' ||
                typeof spaceB.rect.width !== 'number' ||
                typeof spaceB.rect.height !== 'number'
              ) {
                return null
              }

              return {
                spaceAX: spaceA.rect.x,
                spaceAY: spaceA.rect.y,
                spaceAWidth: spaceA.rect.width,
                spaceAHeight: spaceA.rect.height,
                spaceBX: spaceB.rect.x,
                spaceBY: spaceB.rect.y,
                spaceBWidth: spaceB.rect.width,
                spaceBHeight: spaceB.rect.height,
              }
            },
            {
              key: storageKey,
              spaceAId: 'mixed-node-origin-space-a',
              spaceBId: 'mixed-node-origin-space-b',
            },
          )
          .catch(() => null)

        const timeout = new Promise<null>(resolve => {
          setTimeout(() => resolve(null), 2_000)
        })

        return (await Promise.race([evaluation, timeout])) as Awaited<typeof evaluation>
      }

      const before = await readState()
      if (!before) {
        throw new Error('failed to read initial node-origin space rects')
      }

      const outsideHeaderBox = await readLocatorClientRect(outsideHeader)
      const dragStartX = outsideHeaderBox.x + 40
      const dragStartY = outsideHeaderBox.y + 20
      const paneBox = await readLocatorClientRect(pane)
      const dragMargin = 48
      const desiredDragDx = Math.min(360, Math.max(240, Math.round(paneBox.width * 0.3)))
      const dragEndX = Math.min(paneBox.x + paneBox.width - dragMargin, dragStartX + desiredDragDx)
      const dragEndY = Math.min(
        paneBox.y + paneBox.height - dragMargin,
        Math.max(paneBox.y + dragMargin, dragStartY),
      )
      const effectiveDragDx = dragEndX - dragStartX
      const minExpectedSpaceShift = Math.max(
        120,
        Math.min(200, Math.round(Math.abs(effectiveDragDx) * 0.6)),
      )

      await dragMouse(window, {
        start: { x: dragStartX, y: dragStartY },
        end: { x: dragEndX, y: dragEndY },
        steps: 12,
        settleAfterPressMs: 64,
        settleBeforeReleaseMs: 96,
        settleAfterReleaseMs: 64,
      })

      await expect
        .poll(async () => {
          const after = await readState()
          return after ? after.spaceAX - before.spaceAX : Number.NaN
        })
        .toBeGreaterThan(minExpectedSpaceShift)

      await expect
        .poll(async () => {
          const after = await readState()
          if (!after) {
            return false
          }

          const spaceARight = after.spaceAX + after.spaceAWidth
          const spaceABottom = after.spaceAY + after.spaceAHeight
          const spaceBRight = after.spaceBX + after.spaceBWidth
          const spaceBBottom = after.spaceBY + after.spaceBHeight

          return !(
            spaceARight > after.spaceBX &&
            after.spaceAX < spaceBRight &&
            spaceABottom > after.spaceBY &&
            after.spaceAY < spaceBBottom
          )
        })
        .toBe(true)
    } finally {
      await electronApp.close()
    }
  })
})
