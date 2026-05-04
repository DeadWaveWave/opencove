import { expect, test } from '@playwright/test'
import {
  clickHeaderDragSurface,
  clearAndSeedWorkspace,
  launchApp,
} from './workspace-canvas.helpers'

test.describe('Workspace Canvas - Terminal Header Body Focus', () => {
  test('keeps terminal focused after header click then body click', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(window, [
        {
          id: 'node-header-body-focus',
          title: 'terminal-header-body-focus',
          position: { x: 160, y: 160 },
          width: 520,
          height: 320,
        },
      ])

      const terminal = window.locator('.terminal-node').first()
      await expect(terminal).toBeVisible()

      const header = terminal.locator('.terminal-node__header')
      await expect(header).toBeVisible()

      const xterm = terminal.locator('.xterm')
      await expect(xterm).toBeVisible()

      const terminalInput = terminal.locator('.xterm-helper-textarea')

      await xterm.click()
      await expect(terminalInput).toBeFocused()

      await clickHeaderDragSurface(header)
      await expect(terminalInput).not.toBeFocused()

      await xterm.click()
      await expect(terminalInput).toBeFocused()
      await window.waitForTimeout(50)
      await expect(terminalInput).toBeFocused()
    } finally {
      await electronApp.close()
    }
  })
})
