import { expect, test } from '@playwright/test'
import {
  clickHeaderDragSurface,
  clearAndSeedWorkspace,
  launchApp,
} from './workspace-canvas.helpers'

test.describe('Workspace Canvas - Selection', () => {
  test('keeps terminal window focus ring stable while typing', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'mouse-terminal-focus-ring-node',
            title: 'terminal-mouse-focus-ring',
            position: { x: 220, y: 180 },
            width: 460,
            height: 300,
          },
        ],
        {
          settings: {
            canvasInputMode: 'mouse',
          },
        },
      )

      const terminal = window
        .locator('.terminal-node')
        .filter({ hasText: 'terminal-mouse-focus-ring' })
        .first()
      await expect(terminal).toBeVisible()

      const readBorderColor = async (): Promise<string> => {
        return await terminal.evaluate(element => {
          const style = window.getComputedStyle(element)
          return style.borderColor
        })
      }

      const selectionBorderColor = await terminal.evaluate(element => {
        const style = window.getComputedStyle(element)
        return style.getPropertyValue('--cove-node-selection-border').trim()
      })

      const defaultBorderColor = await terminal.evaluate(element => {
        const style = window.getComputedStyle(element)
        return style.getPropertyValue('--cove-node-border').trim()
      })

      const normalizeColor = (value: string) => value.replaceAll(/\s+/g, '').toLowerCase()

      const header = terminal.locator('.terminal-node__header')
      await expect(header).toBeVisible()
      await clickHeaderDragSurface(header)
      await expect(window.locator('.react-flow__node.selected')).toHaveCount(1)

      await expect
        .poll(async () => normalizeColor(await readBorderColor()), {
          message: 'expected selected terminal border color to match selection color',
        })
        .toBe(normalizeColor(selectionBorderColor))

      const xterm = terminal.locator('.xterm').first()
      await expect(xterm).toBeVisible()
      await xterm.click({ position: { x: 50, y: 50 } })

      const terminalInput = terminal.locator('.xterm-helper-textarea')
      await expect(terminalInput).toBeFocused()
      await expect(window.locator('.react-flow__node.selected')).toHaveCount(0)

      await window.keyboard.type('hello')

      const borderAfterTyping = normalizeColor(await readBorderColor())
      expect(borderAfterTyping).toBe(normalizeColor(selectionBorderColor))
      expect(borderAfterTyping).not.toBe(normalizeColor(defaultBorderColor))
    } finally {
      await electronApp.close()
    }
  })
})
