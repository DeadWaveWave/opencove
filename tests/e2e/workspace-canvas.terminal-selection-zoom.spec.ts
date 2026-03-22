import { expect, test } from '@playwright/test'
import {
  buildNodeEvalCommand,
  clearAndSeedWorkspace,
  launchApp,
  readCanvasViewport,
} from './workspace-canvas.helpers'

test.describe('Workspace Canvas - Terminal Selection (Zoom)', () => {
  test('drag selection follows the mouse while zoomed', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(window, [
        {
          id: 'node-selection-zoom',
          title: 'terminal-selection-zoom',
          position: { x: 120, y: 120 },
          width: 520,
          height: 320,
        },
      ])

      const terminal = window.locator('.terminal-node').first()
      await expect(terminal).toBeVisible()
      const xterm = terminal.locator('.xterm')
      await expect(xterm).toBeVisible()

      await xterm.click()
      await expect(terminal.locator('.xterm-helper-textarea')).toBeFocused()

      await window.keyboard.type(
        buildNodeEvalCommand(
          "process.stdout.write('\\u001b[2J\\u001b[H');process.stdout.write('ABCDEFGHIJKLMNOPQRSTUVWXYZ\\n');setInterval(()=>{},1000)",
        ),
      )
      await window.keyboard.press('Enter')
      await expect(terminal).toContainText('ABCDEFGHIJKLMNOPQRSTUVWXYZ')

      const zoomInButton = window.locator('.react-flow__controls-zoomin')
      await expect(zoomInButton).toBeVisible()
      await zoomInButton.click()
      await zoomInButton.click()

      await expect
        .poll(async () => {
          return (await readCanvasViewport(window)).zoom
        })
        .toBeGreaterThan(1.01)

      const dragPoints = await window
        .waitForFunction(
          nodeId => {
            const api = window.__opencoveTerminalSelectionTestApi
            if (!api) {
              return null
            }

            // Row 1 contains the printed alphabet after the ANSI clear + home.
            const start = api.getCellCenter(nodeId, 2, 1)
            const end = api.getCellCenter(nodeId, 6, 1)
            if (!start || !end) {
              return null
            }

            const startElement = document.elementFromPoint(start.x, start.y)
            const endElement = document.elementFromPoint(end.x, end.y)
            if (!startElement?.closest('.xterm-screen') || !endElement?.closest('.xterm-screen')) {
              return null
            }

            api.clearSelection(nodeId)

            return { start, end }
          },
          'node-selection-zoom',
          { timeout: 15_000 },
        )
        .then(handle => handle.jsonValue())

      await window.mouse.move(dragPoints.start.x, dragPoints.start.y)
      await window.mouse.down()
      await window.mouse.move(dragPoints.end.x, dragPoints.end.y, { steps: 8 })
      await window.mouse.up()

      await expect
        .poll(async () => {
          return await window.evaluate(nodeId => {
            const api = window.__opencoveTerminalSelectionTestApi
            return api?.getSelection(nodeId) ?? ''
          }, 'node-selection-zoom')
        })
        .toMatch(/^BCDE/)
    } finally {
      await electronApp.close()
    }
  })
})
