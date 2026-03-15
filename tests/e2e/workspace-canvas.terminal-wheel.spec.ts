import { expect, test } from '@playwright/test'
import {
  buildEchoSequenceCommand,
  clearAndSeedWorkspace,
  launchApp,
} from './workspace-canvas.helpers'

test.describe('Workspace Canvas - Terminal Wheel', () => {
  test('wheel over terminal does not zoom canvas', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(window, [
        {
          id: 'node-wheel',
          title: 'terminal-wheel',
          position: { x: 120, y: 120 },
          width: 460,
          height: 300,
        },
      ])

      const terminal = window.locator('.terminal-node').first()
      await expect(terminal).toBeVisible()
      await expect(terminal.locator('.xterm')).toBeVisible()

      const viewport = window.locator('.react-flow__viewport')
      const beforeTransform = await viewport.getAttribute('style')

      await terminal.hover()
      await window.mouse.wheel(0, -1200)

      const afterTransform = await viewport.getAttribute('style')
      expect(afterTransform).toBe(beforeTransform)
      await expect(terminal.locator('.xterm')).toBeVisible()
    } finally {
      await electronApp.close()
    }
  })

  test('wheel over terminal scrolls terminal viewport', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(window, [
        {
          id: 'node-scroll',
          title: 'terminal-scroll',
          position: { x: 120, y: 120 },
          width: 460,
          height: 300,
        },
      ])

      const terminal = window.locator('.terminal-node').first()
      await expect(terminal).toBeVisible()
      const xterm = terminal.locator('.xterm')
      await expect(xterm).toBeVisible()
      await xterm.click()
      const terminalInput = terminal.locator('.xterm-helper-textarea')
      await expect(terminalInput).toBeFocused()
      await window.keyboard.type(buildEchoSequenceCommand('OPENCOVE_SCROLL', 260))
      await window.keyboard.press('Enter')
      await expect(terminal).toContainText('OPENCOVE_SCROLL_260')

      const viewport = terminal.locator('.xterm-viewport')
      await expect(viewport).toBeVisible()

      const visibleRows = terminal.locator('.xterm-rows')
      const beforeRows = await visibleRows.innerText()

      await terminal.hover()
      await window.mouse.wheel(0, -1200)
      await window.waitForTimeout(120)

      const afterRows = await visibleRows.innerText()
      expect(afterRows).not.toBe(beforeRows)
    } finally {
      await electronApp.close()
    }
  })
})
