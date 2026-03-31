import { expect, test } from '@playwright/test'
import { clearAndSeedWorkspace, launchApp } from './workspace-canvas.helpers'

test.describe('Workspace Canvas - Terminal Enter Focus', () => {
  test('keeps terminal input focused after pressing Enter', async () => {
    const terminalFontSize = 20
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'node-enter-focus',
            title: 'terminal-enter-focus',
            position: { x: 120, y: 120 },
            width: 460,
            height: 300,
          },
        ],
        { settings: { terminalFontSize } },
      )

      const terminal = window.locator('.terminal-node').first()
      await expect(terminal).toBeVisible()
      const xterm = terminal.locator('.xterm')
      await expect(xterm).toBeVisible()
      const xtermHandle = await xterm.elementHandle()
      expect(xtermHandle).not.toBeNull()

      await xterm.click()
      const terminalInput = terminal.locator('.xterm-helper-textarea')
      await expect(terminalInput).toBeFocused()
      await expect
        .poll(async () => {
          const options = await window.evaluate(() => {
            return (
              window.__opencoveTerminalSelectionTestApi?.getFontOptions?.('node-enter-focus') ??
              null
            )
          })
          return options?.fontSize ?? null
        })
        .toBe(terminalFontSize)

      await window.keyboard.type('echo OPENCOVE_ENTER_FOCUS_1')
      await window.keyboard.press('Enter')
      await expect(terminal).toContainText('OPENCOVE_ENTER_FOCUS_1')
      await expect(terminalInput).toBeFocused()
      await expect
        .poll(async () => {
          const options = await window.evaluate(() => {
            return (
              window.__opencoveTerminalSelectionTestApi?.getFontOptions?.('node-enter-focus') ??
              null
            )
          })
          return options?.fontSize ?? null
        })
        .toBe(terminalFontSize)
      if (xtermHandle) {
        const isOriginalXtermConnected = await window.evaluate(
          handle => handle.isConnected,
          xtermHandle,
        )
        expect(isOriginalXtermConnected).toBe(true)
      }

      await window.keyboard.type('echo OPENCOVE_ENTER_FOCUS_2')
      await window.keyboard.press('Enter')
      await expect(terminal).toContainText('OPENCOVE_ENTER_FOCUS_2')
      await expect(terminalInput).toBeFocused()
      await expect
        .poll(async () => {
          const options = await window.evaluate(() => {
            return (
              window.__opencoveTerminalSelectionTestApi?.getFontOptions?.('node-enter-focus') ??
              null
            )
          })
          return options?.fontSize ?? null
        })
        .toBe(terminalFontSize)
      if (xtermHandle) {
        const isOriginalXtermConnected = await window.evaluate(
          handle => handle.isConnected,
          xtermHandle,
        )
        expect(isOriginalXtermConnected).toBe(true)
      }
    } finally {
      await electronApp.close()
    }
  })
})
