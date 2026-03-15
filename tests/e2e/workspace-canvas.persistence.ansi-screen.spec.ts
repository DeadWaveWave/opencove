import { expect, test } from '@playwright/test'
import {
  buildNodeEvalCommand,
  launchApp,
  seedWorkspaceState,
  testWorkspacePath,
} from './workspace-canvas.helpers'

test.describe('Workspace Canvas - Persistence ANSI screen restore', () => {
  test('preserves full-screen ANSI content after workspace switch', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await seedWorkspaceState(window, {
        activeWorkspaceId: 'workspace-a',
        workspaces: [
          {
            id: 'workspace-a',
            name: 'workspace-a',
            path: testWorkspacePath,
            nodes: [
              {
                id: 'node-a',
                title: 'terminal-a',
                position: { x: 120, y: 120 },
                width: 520,
                height: 320,
              },
            ],
          },
          {
            id: 'workspace-b',
            name: 'workspace-b',
            path: testWorkspacePath,
            nodes: [
              {
                id: 'node-b',
                title: 'terminal-b',
                position: { x: 160, y: 160 },
                width: 460,
                height: 300,
              },
            ],
          },
        ],
      })

      const terminal = window.locator('.terminal-node').first()
      await expect(terminal).toBeVisible()
      await expect(terminal.locator('.xterm')).toBeVisible()

      const command = buildNodeEvalCommand(
        [
          'const esc="\\x1b[";',
          'process.stdout.write("\\x1b[?1049h\\x1b[2J\\x1b[H");',
          'for (let row = 1; row <= 18; row += 1) {',
          '  process.stdout.write(esc + row + ";1HROW_" + row + "_STATIC_" + ".".repeat(64));',
          '}',
          'for (let frame = 0; frame < 30000; frame += 1) {',
          '  process.stdout.write(esc + "20;1HFRAME_" + String(frame).padStart(5, "0") + "_TOKEN");',
          '}',
        ].join(''),
      )

      await terminal.locator('.xterm').click()
      await expect(terminal.locator('.xterm-helper-textarea')).toBeFocused()
      await window.keyboard.type(command)
      await window.keyboard.press('Enter')

      await expect(terminal).toContainText('ROW_10_STATIC', { timeout: 20_000 })
      await expect(terminal).toContainText('FRAME_29999_TOKEN', { timeout: 20_000 })

      await window.locator('.workspace-item').nth(1).click()
      await expect(window.locator('.workspace-item').nth(1)).toHaveClass(/workspace-item--active/)

      await window.locator('.workspace-item').nth(0).click()
      await expect(window.locator('.workspace-item').nth(0)).toHaveClass(/workspace-item--active/)

      const restoredTerminal = window.locator('.terminal-node').first()
      await expect(restoredTerminal).toContainText('FRAME_29999_TOKEN', { timeout: 20_000 })
      await expect(restoredTerminal).toContainText('ROW_10_STATIC', { timeout: 20_000 })
    } finally {
      await electronApp.close()
    }
  })
})
