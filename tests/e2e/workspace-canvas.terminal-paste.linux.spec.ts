import { expect, test, type Locator } from '@playwright/test'
import { clearAndSeedWorkspace, launchApp } from './workspace-canvas.helpers'

const linuxOnly = process.platform !== 'linux'
const PASTED_TOKEN = 'OPENCOVE_LINUX_PASTE_TOKEN'
const DOUBLE_PASTED_TOKEN = `${PASTED_TOKEN}${PASTED_TOKEN}`

async function readVisibleTerminalTranscript(terminal: Locator): Promise<string> {
  return (await terminal.locator('.terminal-node__transcript').textContent()) ?? ''
}

test.describe('Workspace Canvas - Terminal Paste (Linux)', () => {
  test.skip(linuxOnly, 'Linux only')

  test('Ctrl+Shift+V pastes clipboard text into the terminal PTY', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await electronApp.evaluate(async ({ clipboard }) => {
        clipboard.clear()
        clipboard.writeText('OPENCOVE_LINUX_PASTE_TOKEN')
      })

      await clearAndSeedWorkspace(window, [
        {
          id: 'node-paste-linux',
          title: 'terminal-paste-linux',
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

      await window.keyboard.type('printf "%s\\n" "')
      await window.keyboard.press('Control+Shift+V')
      await window.keyboard.type('"')
      await window.keyboard.press('Enter')

      await expect(terminal).toContainText(PASTED_TOKEN)
      await expect
        .poll(async () => {
          const text = await readVisibleTerminalTranscript(terminal)
          return {
            hasPastedToken: text.includes(PASTED_TOKEN),
            hasDuplicatedPaste: text.includes(DOUBLE_PASTED_TOKEN),
          }
        })
        .toEqual({
          hasPastedToken: true,
          hasDuplicatedPaste: false,
        })
    } finally {
      await electronApp.close()
    }
  })
})
