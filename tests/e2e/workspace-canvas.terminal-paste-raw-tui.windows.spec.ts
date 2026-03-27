import path from 'node:path'
import { expect, test } from '@playwright/test'
import { clearAndSeedWorkspace, launchApp, testWorkspacePath } from './workspace-canvas.helpers'

const windowsOnly = process.platform !== 'win32'
const stubScriptPath = path.join(testWorkspacePath, 'scripts', 'test-agent-session-stub.mjs')

const providerCases = [
  { provider: 'codex' as const, label: 'Codex' },
  { provider: 'claude-code' as const, label: 'Claude Code' },
]

test.describe('Workspace Canvas - Terminal Paste Raw TUI (Windows)', () => {
  test.skip(windowsOnly, 'Windows only')

  for (const providerCase of providerCases) {
    test(`${providerCase.label} pastes clipboard text into a raw TUI process`, async () => {
      const pastedToken = `OPENCOVE_RAW_TUI_PASTE_${providerCase.provider.replace(/[^a-z0-9]/gi, '_')}`
      const { electronApp, window } = await launchApp({ cleanupUserDataDir: false })

      try {
        await electronApp.evaluate(async ({ clipboard }, token) => {
          clipboard.clear()
          clipboard.writeText(token)
        }, pastedToken)

        await clearAndSeedWorkspace(window, [
          {
            id: 'node-raw-paste-windows',
            title: 'terminal-raw-paste-windows',
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

        const launchCommand = `node "${stubScriptPath}" ${providerCase.provider} "${testWorkspacePath}" new default-model raw-bracketed-paste-echo`
        await window.keyboard.type(launchCommand)
        await window.keyboard.press('Enter')

        await expect(terminal).toContainText(
          `[opencove-test-agent] ${providerCase.provider} new default-model`,
        )

        await window.keyboard.press('Control+V')

        await expect(terminal).toContainText(`[opencove-test-paste] ${pastedToken}`)
        await expect(terminal).not.toContainText('[opencove-test-paste] ctrl-v')
      } finally {
        await electronApp.close()
      }
    })
  }
})
