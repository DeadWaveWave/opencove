import { expect, test } from '@playwright/test'
import { clearAndSeedWorkspace, launchApp, storageKey } from './workspace-canvas.helpers'

test.describe('Workspace Canvas - Node Resize (Push-away)', () => {
  test('keeps root windows non-overlapping when resizing a terminal outward', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(window, [
        {
          id: 'resize-source',
          title: 'resize-source',
          position: { x: 120, y: 120 },
          width: 460,
          height: 300,
        },
        {
          id: 'resize-blocked',
          title: 'resize-blocked',
          position: { x: 640, y: 120 },
          width: 460,
          height: 300,
        },
      ])

      const sourceNode = window.locator('.terminal-node', { hasText: 'resize-source' }).first()
      await expect(sourceNode).toBeVisible()

      const rightResizer = sourceNode.locator('[data-testid="terminal-resizer-right"]')
      const rightBox = await rightResizer.boundingBox()
      if (!rightBox) {
        throw new Error('terminal right resizer bounding box unavailable')
      }

      const startX = rightBox.x + rightBox.width / 2
      const startY = rightBox.y + rightBox.height / 2

      await window.mouse.move(startX, startY)
      await window.mouse.down()
      await window.mouse.move(startX + 800, startY)
      await window.mouse.up()

      await expect
        .poll(
          async () => {
            return await window.evaluate(async key => {
              void key

              const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
              if (!raw) {
                return false
              }

              const parsed = JSON.parse(raw) as {
                workspaces?: Array<{
                  nodes?: Array<{
                    id?: string
                    position?: { x?: number; y?: number }
                    width?: number
                    height?: number
                  }>
                }>
              }

              const workspace = parsed.workspaces?.[0]
              const nodes = workspace?.nodes ?? []

              const source = nodes.find(node => node.id === 'resize-source')
              const blocked = nodes.find(node => node.id === 'resize-blocked')

              if (
                !source?.position ||
                typeof source.position.x !== 'number' ||
                typeof source.position.y !== 'number' ||
                typeof source.width !== 'number' ||
                typeof source.height !== 'number' ||
                !blocked?.position ||
                typeof blocked.position.x !== 'number' ||
                typeof blocked.position.y !== 'number'
              ) {
                return false
              }

              const gapSatisfied = blocked.position.x >= source.position.x + source.width

              return (
                source.position.x === 120 &&
                source.position.y === 120 &&
                source.width > 460 &&
                source.height === 300 &&
                blocked.position.y === 120 &&
                gapSatisfied
              )
            }, storageKey)
          },
          { timeout: 10_000 },
        )
        .toBe(true)
    } finally {
      await electronApp.close()
    }
  })
})
