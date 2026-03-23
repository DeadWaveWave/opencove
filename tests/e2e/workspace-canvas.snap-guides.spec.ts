import { expect, test } from '@playwright/test'
import { beginDragMouse, clearAndSeedWorkspace, launchApp } from './workspace-canvas.helpers'
import { ensureArtifactsDir, readSeededWorkspaceLayout } from './workspace-canvas.arrange.shared'

test.describe('Workspace Canvas - Snap Guides', () => {
  test('shows live guides during drag and clears them on release', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(window, [
        {
          id: 'snap-a',
          title: 'snap-a',
          position: { x: 100, y: 100 },
          width: 220,
          height: 140,
          kind: 'note',
          task: {
            text: 'snap-a',
          },
        },
        {
          id: 'snap-b',
          title: 'snap-b',
          position: { x: 620, y: 420 },
          width: 220,
          height: 140,
          kind: 'note',
          task: {
            text: 'snap-b',
          },
        },
      ])

      const pane = window.locator('.workspace-canvas .react-flow__pane')
      await expect(pane).toBeVisible()

      const secondHeader = window
        .locator('.react-flow__node')
        .nth(1)
        .locator('[data-node-drag-handle=true]')
      await expect(secondHeader).toBeVisible()

      const startBox = await secondHeader.boundingBox()
      if (!startBox) {
        throw new Error('Second node header bounding box not available')
      }

      const paneBox = await pane.boundingBox()
      if (!paneBox) {
        throw new Error('Pane bounding box not available')
      }

      const drag = await beginDragMouse(window, {
        start: { x: startBox.x + 80, y: startBox.y + 20 },
        initialTarget: { x: paneBox.x + 184, y: paneBox.y + 450 },
      })
      await drag.moveTo({ x: paneBox.x + 184, y: paneBox.y + 450 }, { settleAfterMoveMs: 64 })

      await expect(window.locator('[data-testid="workspace-snap-guide-v"]')).toBeVisible()
      await expect
        .poll(async () => {
          return await window.evaluate(() => {
            const doc = document.documentElement
            return {
              hasVerticalOverflow: doc.scrollHeight > doc.clientHeight,
              hasHorizontalOverflow: doc.scrollWidth > doc.clientWidth,
            }
          })
        })
        .toEqual({ hasVerticalOverflow: false, hasHorizontalOverflow: false })
      await expect
        .poll(async () => {
          const layout = await readSeededWorkspaceLayout(window, {
            nodeIds: ['snap-a', 'snap-b'],
            spaceIds: [],
          })
          const node = layout.nodes['snap-b']

          return {
            x: node?.x ?? null,
            y: node?.y ?? null,
            isStillRaw: node?.x !== 100 && node?.y !== 432,
          }
        })
        .toMatchObject({ isStillRaw: true })

      await ensureArtifactsDir()
      await window.screenshot({ path: 'artifacts/workspace-canvas-snap-guides.visible.png' })

      await drag.release()
      await expect(window.locator('[data-testid="workspace-snap-guides"]')).toHaveCount(0)
    } finally {
      await electronApp.close()
    }
  })
})
