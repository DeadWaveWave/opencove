import { expect, test } from '@playwright/test'
import { buildNodeEvalCommand, clearAndSeedWorkspace, launchApp } from './workspace-canvas.helpers'

const findModifier = process.platform === 'darwin' ? 'Meta' : 'Control'

test.describe('Workspace Canvas - Terminal Find', () => {
  test('opens terminal find via Cmd/Ctrl+F when terminal is focused', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(window, [
        {
          id: 'node-terminal-find',
          title: 'terminal-find',
          position: { x: 140, y: 140 },
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

      const token = `FIND_TOKEN_${Date.now()}`
      await window.keyboard.type(
        buildNodeEvalCommand(`process.stdout.write('${token}\\\\n');setInterval(()=>{},1000)`),
      )
      await window.keyboard.press('Enter')
      await expect(terminal).toContainText(token)

      await window.keyboard.press(`${findModifier}+F`)
      await expect(terminal.locator('[data-testid="terminal-find"]')).toBeVisible()
      await expect(terminal.locator('[data-testid="terminal-find-input"]')).toBeFocused()
      await expect(window.locator('[data-testid="workspace-search"]')).toBeHidden()

      await terminal.locator('[data-testid="terminal-find-input"]').fill(token)

      await expect
        .poll(async () => {
          return await window.evaluate(nodeId => {
            const api = window.__opencoveTerminalSelectionTestApi
            return api?.getSelection(nodeId) ?? ''
          }, 'node-terminal-find')
        })
        .toContain(token)

      await window.keyboard.press('Escape')
      await expect(terminal.locator('[data-testid="terminal-find"]')).toBeHidden()
    } finally {
      await electronApp.close()
    }
  })
})
