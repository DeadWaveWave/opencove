import path from 'node:path'
import { expect, test } from '@playwright/test'
import { clearAndSeedWorkspace, launchApp, testWorkspacePath } from './workspace-canvas.helpers'

const windowsOnly = process.platform !== 'win32'
const stubScriptPath = path.join(testWorkspacePath, 'scripts', 'test-agent-session-stub.mjs')

test.describe('Workspace Canvas - Terminal Wheel Raw TUI (Windows)', () => {
  test.skip(windowsOnly, 'Windows only')

  test.skip('forwards wheel input to an alternate-screen codex-style TUI', async () => {
    const nodeId = 'node-raw-wheel-windows'
    const { electronApp, window } = await launchApp({ cleanupUserDataDir: false })

    try {
      await clearAndSeedWorkspace(window, [
        {
          id: nodeId,
          title: 'terminal-raw-wheel-windows',
          position: { x: 120, y: 120 },
          width: 640,
          height: 360,
        },
      ])

      const terminal = window.locator('.terminal-node').first()
      await expect(terminal).toBeVisible()

      const xterm = terminal.locator('.xterm')
      await expect(xterm).toBeVisible()
      await xterm.click()
      await expect(terminal.locator('.xterm-helper-textarea')).toBeFocused()

      const launchCommand = `node "${stubScriptPath}" codex "${testWorkspacePath}" new default-model raw-alt-screen-wheel-echo`
      await window.keyboard.type(launchCommand)
      await window.keyboard.press('Enter')

      await expect(terminal).toContainText('ALT_SCREEN_WHEEL_READY')

      const x10WheelReport = '\u001b[M' + String.fromCharCode(32 + 64, 32 + 120, 32 + 120)
      const dispatched = await window.evaluate(
        ({ currentNodeId, report }) => {
          const api = window.__opencoveTerminalSelectionTestApi
          if (!api || typeof api.emitBinaryInput !== 'function') {
            return false
          }

          return api.emitBinaryInput(currentNodeId, report)
        },
        { currentNodeId: nodeId, report: x10WheelReport },
      )

      expect(dispatched).toBe(true)

      await expect(terminal).toContainText('[opencove-test-wheel] wheel-up')
      await expect(terminal).not.toContainText('[opencove-test-wheel] timeout')
    } finally {
      await electronApp.close()
    }
  })
})
