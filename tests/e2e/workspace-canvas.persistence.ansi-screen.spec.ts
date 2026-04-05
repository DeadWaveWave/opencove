import { expect, test } from '@playwright/test'
import {
  buildNodeEvalCommand,
  launchApp,
  seedWorkspaceState,
  testWorkspacePath,
} from './workspace-canvas.helpers'

test.describe('Workspace Canvas - Persistence ANSI screen restore', () => {
  test('preserves full-screen ANSI content after workspace switch', async () => {
    const isCi = process.env.CI === '1' || process.env.CI === 'true'
    const terminalFontSize = 13
    // This is an intentionally heavy stress-style test. Keep CI runtime and disk usage bounded.
    const frameCount = isCi ? 5000 : 30000
    const lastFrameToken = `FRAME_${String(frameCount - 1).padStart(5, '0')}_TOKEN`
    const { electronApp, window } = await launchApp({
      env: {
        OPENCOVE_TERMINAL_DIAGNOSTICS: '1',
      },
    })

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
        settings: {
          standardWindowSizeBucket: 'regular',
          terminalFontSize,
        },
      })

      const terminal = window.locator('.terminal-node').first()
      await expect(terminal).toBeVisible()
      await expect(terminal.locator('.xterm')).toBeVisible()

      const initialSize = await window.evaluate(() => {
        return window.__opencoveTerminalSelectionTestApi?.getSize?.('node-a') ?? null
      })
      // Useful when debugging linux-only fit/hydration regressions (printed to CI logs on failure).
      // eslint-disable-next-line no-console
      console.log('[ansi-screen] initial size', initialSize)

      const command = buildNodeEvalCommand(
        [
          'const esc="\\x1b[";',
          'process.stdout.write("\\x1b[?1049h\\x1b[2J\\x1b[H");',
          'for (let row = 1; row <= 18; row += 1) {',
          '  process.stdout.write(esc + row + ";1HROW_" + row + "_STATIC_" + ".".repeat(64));',
          '}',
          `for (let frame = 0; frame < ${frameCount}; frame += 1) {`,
          '  process.stdout.write(esc + "20;1HFRAME_" + String(frame).padStart(5, "0") + "_TOKEN");',
          '}',
        ].join(''),
      )

      await terminal.locator('.xterm').click()
      const terminalInput = terminal.locator('.xterm-helper-textarea')
      await expect(terminalInput).toBeFocused()
      await expect
        .poll(async () => {
          const options = await window.evaluate(() => {
            return window.__opencoveTerminalSelectionTestApi?.getFontOptions?.('node-a') ?? null
          })
          return options?.fontSize ?? null
        })
        .toBe(terminalFontSize)
      await window.keyboard.type(command)
      await window.keyboard.press('Enter')

      await expect(terminal).toContainText('ROW_10_STATIC', { timeout: 20_000 })
      await expect(terminal).toContainText(lastFrameToken, { timeout: 20_000 })

      const beforeSwitchSize = await window.evaluate(() => {
        return window.__opencoveTerminalSelectionTestApi?.getSize?.('node-a') ?? null
      })
      // eslint-disable-next-line no-console
      console.log('[ansi-screen] before switch size', beforeSwitchSize)
      const beforeSwitchHasFrame = await terminal.evaluate((el, token) => {
        return el.textContent?.includes(token) ?? false
      }, lastFrameToken)
      // eslint-disable-next-line no-console
      console.log('[ansi-screen] before switch has frame', beforeSwitchHasFrame)

      await window.locator('.workspace-item').nth(1).click()
      await expect(window.locator('.workspace-item').nth(1)).toHaveClass(/workspace-item--active/)
      const afterUnmountCache = await window.evaluate(() => {
        return (
          window.__opencoveTerminalSelectionTestApi?.getCachedScreenStateSummary?.('node-a') ?? null
        )
      })
      // eslint-disable-next-line no-console
      console.log('[ansi-screen] after unmount cache', afterUnmountCache)

      await window.locator('.workspace-item').nth(0).click()
      await expect(window.locator('.workspace-item').nth(0)).toHaveClass(/workspace-item--active/)

      const afterRestoreSize = await window.evaluate(() => {
        return window.__opencoveTerminalSelectionTestApi?.getSize?.('node-a') ?? null
      })
      // eslint-disable-next-line no-console
      console.log('[ansi-screen] after restore size', afterRestoreSize)
      const afterRestoreCache = await window.evaluate(() => {
        return (
          window.__opencoveTerminalSelectionTestApi?.getCachedScreenStateSummary?.('node-a') ?? null
        )
      })
      // eslint-disable-next-line no-console
      console.log('[ansi-screen] after restore cache', afterRestoreCache)

      const restoredTerminal = window.locator('.terminal-node').first()
      const afterRestoreHasFrame = await restoredTerminal.evaluate((el, token) => {
        return el.textContent?.includes(token) ?? false
      }, lastFrameToken)
      // eslint-disable-next-line no-console
      console.log('[ansi-screen] after restore has frame', afterRestoreHasFrame)
      await expect(restoredTerminal).toContainText(lastFrameToken, { timeout: 20_000 })
      await expect(restoredTerminal).toContainText('ROW_10_STATIC', { timeout: 20_000 })

      await restoredTerminal.locator('.xterm').click()
      const restoredInput = restoredTerminal.locator('.xterm-helper-textarea')
      await expect(restoredInput).toBeFocused()
      await expect
        .poll(async () => {
          const options = await window.evaluate(() => {
            return window.__opencoveTerminalSelectionTestApi?.getFontOptions?.('node-a') ?? null
          })
          return options?.fontSize ?? null
        })
        .toBe(terminalFontSize)
      await window.keyboard.press('Enter')
      await expect(restoredInput).toBeFocused()
      await expect
        .poll(async () => {
          const options = await window.evaluate(() => {
            return window.__opencoveTerminalSelectionTestApi?.getFontOptions?.('node-a') ?? null
          })
          return options?.fontSize ?? null
        })
        .toBe(terminalFontSize)
    } finally {
      await electronApp.close()
    }
  })
})
