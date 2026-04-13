import { expect, test } from '@playwright/test'
import { clearAndSeedWorkspace, launchApp } from './workspace-canvas.helpers'

const windowsOnly = process.platform !== 'win32'
const READY_ENV_KEY = 'OPENCOVE_WINDOWS_COPY_READY_TOKEN'
const SIGINT_ENV_KEY = 'OPENCOVE_WINDOWS_COPY_SIGINT_TOKEN'

async function selectTerminalOutput(
  window: Parameters<typeof clearAndSeedWorkspace>[0],
  nodeId: string,
) {
  return await window.evaluate(async currentNodeId => {
    const api = window.__opencoveTerminalSelectionTestApi
    if (!api) {
      return { hasSelection: false, selection: null }
    }

    api.selectAll(currentNodeId)

    await new Promise<void>(resolve => {
      window.requestAnimationFrame(() => resolve())
    })

    return {
      hasSelection: api.hasSelection(currentNodeId),
      selection: api.getSelection(currentNodeId),
    }
  }, nodeId)
}

test.describe('Workspace Canvas - Terminal Copy (Windows)', () => {
  test.skip(windowsOnly, 'Windows only')

  test('Ctrl+C copies selected terminal output without sending SIGINT', async () => {
    const readyToken = `OPENCOVE_WINDOWS_COPY_READY_${Date.now()}`
    const sigintToken = `OPENCOVE_WINDOWS_COPY_SIGINT_${Date.now()}`
    const { electronApp, window } = await launchApp({
      env: {
        [READY_ENV_KEY]: readyToken,
        [SIGINT_ENV_KEY]: sigintToken,
      },
    })

    try {
      await electronApp.evaluate(async ({ clipboard }) => {
        clipboard.clear()
      })

      await clearAndSeedWorkspace(window, [
        {
          id: 'node-copy-windows',
          title: 'terminal-copy-windows',
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
      const terminalInput = terminal.locator('.xterm-helper-textarea')
      await expect(terminalInput).toBeFocused()

      // Wait for the shell prompt to appear before sending the long node command.
      await expect(terminal).toContainText(/PS .*?>/i, { timeout: 30_000 })

      await terminalInput.type(
        `node -e "const ready=process.env.${READY_ENV_KEY};const sigint=process.env.${SIGINT_ENV_KEY};process.on('SIGINT',()=>{console.log(sigint);process.exit(130)});console.log(ready);setInterval(()=>{},1000)"`,
      )
      await terminalInput.press('Enter')
      await expect(terminal).toContainText(readyToken, { timeout: 60_000 })

      await expect
        .poll(async () => await selectTerminalOutput(window, 'node-copy-windows'))
        .toMatchObject({
          hasSelection: true,
          selection: expect.stringContaining(readyToken),
        })

      await window.keyboard.press('Control+C')
      await window.waitForTimeout(250)

      await expect(terminal).not.toContainText(sigintToken)

      const clipboardText = await electronApp.evaluate(async ({ clipboard }) => {
        return clipboard.readText()
      })
      expect(clipboardText).toContain(readyToken)
    } finally {
      await electronApp.close()
    }
  })
})
