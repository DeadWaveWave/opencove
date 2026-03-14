import { expect, test } from '@playwright/test'
import { clearAndSeedWorkspace, launchApp } from './workspace-canvas.helpers'

const windowsOnly = process.platform !== 'win32'
const PASTED_TOKEN = 'OPENCOVE_WINDOWS_PASTE_TOKEN'

test.describe('Workspace Canvas - Terminal Paste (Windows)', () => {
  test.skip(windowsOnly, 'Windows only')

  test('Ctrl+V pastes clipboard text into the terminal PTY', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await electronApp.evaluate(async ({ clipboard }) => {
        clipboard.clear()
        clipboard.writeText('OPENCOVE_WINDOWS_PASTE_TOKEN')
      })

      await clearAndSeedWorkspace(window, [
        {
          id: 'node-paste-windows',
          title: 'terminal-paste-windows',
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

      await window.keyboard.type('Write-Output "')
      await window.keyboard.press('Control+V')
      await window.keyboard.type('"')
      await window.keyboard.press('Enter')

      await expect(terminal).toContainText(PASTED_TOKEN)
    } finally {
      await electronApp.close()
    }
  })
})
