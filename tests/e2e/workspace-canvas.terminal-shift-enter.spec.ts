import { expect, test } from '@playwright/test'
import { buildNodeEvalCommand, clearAndSeedWorkspace, launchApp } from './workspace-canvas.helpers'

test.describe('Workspace Canvas - Terminal Shift Enter', () => {
  test('writes escape-enter bytes for Shift+Enter inside terminal input', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(window, [
        {
          id: 'node-shift-enter',
          title: 'terminal-shift-enter',
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

      await window.keyboard.type(
        buildNodeEvalCommand(
          'process.stdin.setRawMode(true);process.stdin.resume();console.log("OPENCOVE_SHIFT_ENTER_READY");const bytes=[];const finish=()=>{console.log("OPENCOVE_SHIFT_ENTER_CODES:"+bytes.join(","));process.exit(0)};process.stdin.on("data",d=>{for(const b of d)bytes.push(b);if(bytes.length>=2){finish()}});setTimeout(finish,3000)',
        ),
      )
      await window.keyboard.press('Enter')
      await expect(terminal).toContainText('OPENCOVE_SHIFT_ENTER_READY')

      await window.keyboard.down('Shift')
      await window.keyboard.press('Enter')
      await window.keyboard.up('Shift')

      await expect(terminal).toContainText('OPENCOVE_SHIFT_ENTER_CODES:27,13')
    } finally {
      await electronApp.close()
    }
  })
})
