import { expect, test } from '@playwright/test'
import { clearAndSeedWorkspace, launchApp } from './workspace-canvas.helpers'

test.describe('Workspace Canvas - Terminal resize shrink', () => {
  test('reflows terminal when resizing smaller after expanding', async () => {
    const { electronApp, window } = await launchApp()

    try {
      const nodeId = 'terminal-resize-shrink'

      await clearAndSeedWorkspace(window, [
        {
          id: nodeId,
          title: nodeId,
          position: { x: 160, y: 140 },
          width: 680,
          height: 360,
        },
      ])

      const terminal = window.locator('.terminal-node').first()
      await expect(terminal).toBeVisible()
      await expect(terminal.locator('.xterm')).toBeVisible()

      const readSize = async () => {
        return await window.evaluate(id => {
          return window.__opencoveTerminalSelectionTestApi?.getSize?.(id) ?? null
        }, nodeId)
      }

      await expect.poll(readSize).toBeTruthy()
      const initialSize = (await readSize())!

      const rightResizer = terminal.locator('[data-testid="terminal-resizer-right"]')
      await expect(rightResizer).toBeVisible()

      const rightBox = await rightResizer.boundingBox()
      if (!rightBox) {
        throw new Error('terminal right resizer bounding box unavailable')
      }

      const rightStartX = rightBox.x + rightBox.width / 2
      const rightStartY = rightBox.y + rightBox.height / 2

      await window.mouse.move(rightStartX, rightStartY)
      await window.mouse.down()
      await window.mouse.move(rightStartX + 240, rightStartY, { steps: 12 })
      await window.mouse.up()

      await expect
        .poll(async () => (await readSize())?.cols ?? 0)
        .toBeGreaterThan(initialSize.cols)
      const expandedWidthSize = (await readSize())!

      const rightBoxAfterExpand = await rightResizer.boundingBox()
      if (!rightBoxAfterExpand) {
        throw new Error('terminal right resizer bounding box unavailable (after expand)')
      }

      const rightExpandedX = rightBoxAfterExpand.x + rightBoxAfterExpand.width / 2
      const rightExpandedY = rightBoxAfterExpand.y + rightBoxAfterExpand.height / 2

      await window.mouse.move(rightExpandedX, rightExpandedY)
      await window.mouse.down()
      await window.mouse.move(rightExpandedX - 320, rightExpandedY, { steps: 12 })
      await window.mouse.up()

      await expect
        .poll(async () => (await readSize())?.cols ?? Number.POSITIVE_INFINITY)
        .toBeLessThan(expandedWidthSize.cols)

      const bottomResizer = terminal.locator('[data-testid="terminal-resizer-bottom"]')
      await expect(bottomResizer).toBeVisible()

      const bottomBox = await bottomResizer.boundingBox()
      if (!bottomBox) {
        throw new Error('terminal bottom resizer bounding box unavailable')
      }

      const bottomStartX = bottomBox.x + bottomBox.width / 2
      const bottomStartY = bottomBox.y + bottomBox.height / 2

      const beforeHeightSize = (await readSize())!

      await window.mouse.move(bottomStartX, bottomStartY)
      await window.mouse.down()
      await window.mouse.move(bottomStartX, bottomStartY + 160, { steps: 12 })
      await window.mouse.up()

      await expect
        .poll(async () => (await readSize())?.rows ?? 0)
        .toBeGreaterThan(beforeHeightSize.rows)
      const expandedHeightSize = (await readSize())!

      const bottomBoxAfterExpand = await bottomResizer.boundingBox()
      if (!bottomBoxAfterExpand) {
        throw new Error('terminal bottom resizer bounding box unavailable (after expand)')
      }

      const bottomExpandedX = bottomBoxAfterExpand.x + bottomBoxAfterExpand.width / 2
      const bottomExpandedY = bottomBoxAfterExpand.y + bottomBoxAfterExpand.height / 2

      await window.mouse.move(bottomExpandedX, bottomExpandedY)
      await window.mouse.down()
      await window.mouse.move(bottomExpandedX, bottomExpandedY - 220, { steps: 12 })
      await window.mouse.up()

      await expect
        .poll(async () => (await readSize())?.rows ?? Number.POSITIVE_INFINITY)
        .toBeLessThan(expandedHeightSize.rows)
    } finally {
      await electronApp.close()
    }
  })
})

