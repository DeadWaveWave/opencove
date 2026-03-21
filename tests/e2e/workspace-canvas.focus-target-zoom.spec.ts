import { expect, test } from '@playwright/test'
import { clearAndSeedWorkspace, launchApp, readCanvasViewport } from './workspace-canvas.helpers'

test.describe('Workspace Canvas - Focus Target Zoom', () => {
  test('focuses nodes to the configured target zoom on click', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'focus-zoom-node',
            title: 'terminal-focus-zoom',
            position: { x: 220, y: 180 },
            width: 460,
            height: 300,
          },
        ],
        {
          settings: {
            focusNodeOnClick: true,
            focusNodeTargetZoom: 1.5,
          },
        },
      )

      await expect(window.locator('.workspace-canvas')).toBeVisible()
      await expect
        .poll(async () => {
          return (await readCanvasViewport(window)).zoom
        })
        .toBeCloseTo(1, 2)

      const terminal = window.locator('.terminal-node', { hasText: 'terminal-focus-zoom' }).first()
      const terminalBody = terminal.locator('.terminal-node__terminal')
      await expect(terminalBody).toBeVisible()

      const terminalBox = await terminalBody.boundingBox()
      if (!terminalBox) {
        throw new Error('terminal bounding box unavailable for focus click')
      }

      await window.mouse.click(
        terminalBox.x + terminalBox.width / 2,
        terminalBox.y + Math.min(96, terminalBox.height / 2),
      )

      await expect
        .poll(async () => {
          return (await readCanvasViewport(window)).zoom
        })
        .toBeCloseTo(1.5, 2)
    } finally {
      await electronApp.close()
    }
  })
})
