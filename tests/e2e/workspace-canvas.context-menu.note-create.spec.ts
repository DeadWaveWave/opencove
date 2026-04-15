import { expect, test } from '@playwright/test'
import { clearAndSeedWorkspace, launchApp } from './workspace-canvas.helpers'
import {
  clickPaneAtFlowPoint,
  openPaneContextMenuAtFlowPoint,
} from './workspace-canvas.arrange.shared'

test.describe('Workspace Canvas - Context Menu Note Create', () => {
  test('positions the pane context menu near the pointer and only shifts when it would overflow', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(window, [])

      const pane = window.locator('.workspace-canvas .react-flow__pane')
      await expect(pane).toBeVisible()

      const paneBox = await pane.boundingBox()
      if (!paneBox) {
        throw new Error('workspace pane bounding box unavailable')
      }

      const viewport = await window.evaluate(() => ({
        width: window.innerWidth,
        height: window.innerHeight,
      }))

      // Keep this point far enough from all edges so the menu does not need to shift.
      // The menu can grow as new root-level items are added (e.g. quick menu entries).
      const roomyPoint = {
        x: Math.floor(Math.max(80, Math.min(180, paneBox.width - 420))),
        y: Math.floor(Math.max(80, Math.min(180, paneBox.height - 520))),
      }

      await openPaneContextMenuAtFlowPoint(window, pane, roomyPoint)

      const menu = window.locator('.workspace-context-menu').first()
      await expect(menu).toBeVisible()

      const roomyMenuBox = await menu.boundingBox()
      if (!roomyMenuBox) {
        throw new Error('workspace context menu bounding box unavailable')
      }

      const roomyClientX = paneBox.x + roomyPoint.x
      const roomyClientY = paneBox.y + roomyPoint.y

      expect(roomyMenuBox.x).toBeGreaterThanOrEqual(roomyClientX - 1)
      expect(roomyMenuBox.y).toBeGreaterThanOrEqual(roomyClientY - 1)

      await clickPaneAtFlowPoint(window, pane, { x: 20, y: 20 })
      await expect(window.locator('.workspace-context-menu')).toHaveCount(0)

      const edgePoint = {
        x: Math.floor(Math.max(40, paneBox.width - 24)),
        y: Math.floor(Math.max(40, paneBox.height - 24)),
      }

      await openPaneContextMenuAtFlowPoint(window, pane, edgePoint)

      await expect(menu).toBeVisible()

      const edgeMenuBox = await menu.boundingBox()
      if (!edgeMenuBox) {
        throw new Error('workspace context menu edge bounding box unavailable')
      }

      const edgeClientX = paneBox.x + edgePoint.x
      const edgeClientY = paneBox.y + edgePoint.y

      expect(edgeMenuBox.x).toBeLessThanOrEqual(edgeClientX)
      expect(edgeMenuBox.y).toBeLessThanOrEqual(edgeClientY)
      expect(edgeMenuBox.x + edgeMenuBox.width).toBeLessThanOrEqual(viewport.width + 12)
      expect(edgeMenuBox.y + edgeMenuBox.height).toBeLessThanOrEqual(viewport.height + 12)
    } finally {
      await electronApp.close()
    }
  })

  test('shows note creation in the blank pane menu', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(window, [])

      const pane = window.locator('.workspace-canvas .react-flow__pane')
      await expect(pane).toBeVisible()

      await pane.click({
        button: 'right',
        position: { x: 80, y: 80 },
      })

      await expect(window.locator('[data-testid="workspace-context-new-terminal"]')).toBeVisible()
      await expect(window.locator('[data-testid="workspace-context-new-note"]')).toBeVisible()
      await expect(window.locator('[data-testid="workspace-context-new-task"]')).toBeVisible()
    } finally {
      await electronApp.close()
    }
  })

  test('creates a note from the blank pane right-click menu', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(window, [])

      const pane = window.locator('.workspace-canvas .react-flow__pane')
      await expect(pane).toBeVisible()

      await pane.click({
        button: 'right',
        position: { x: 240, y: 180 },
      })

      await window.locator('[data-testid="workspace-context-new-note"]').click()

      const noteNode = window.locator('.note-node').first()
      await expect(noteNode).toBeVisible()
      await expect(noteNode.locator('[data-testid="note-node-title"]')).toHaveText('note')
      await expect(window.locator('.workspace-context-menu')).toHaveCount(0)

      await expect
        .poll(async () => {
          return await window.evaluate(async () => {
            const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
            if (!raw) {
              return 0
            }

            const parsed = JSON.parse(raw) as {
              workspaces?: Array<{
                nodes?: Array<{
                  kind?: string
                }>
              }>
            }

            return parsed.workspaces?.[0]?.nodes?.filter(node => node.kind === 'note').length ?? 0
          })
        })
        .toBe(1)
    } finally {
      await electronApp.close()
    }
  })
})
