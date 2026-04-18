import { expect, test } from '@playwright/test'
import { clearAndSeedWorkspace, launchApp } from './workspace-canvas.helpers'

const linuxOnly = process.platform !== 'linux'
const READY_ENV_KEY = 'OPENCOVE_LINUX_COPY_READY_TOKEN'
const SIGINT_ENV_KEY = 'OPENCOVE_LINUX_COPY_SIGINT_TOKEN'

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

test.describe('Workspace Canvas - Terminal Copy (Linux)', () => {
  test.skip(linuxOnly, 'Linux only')

  test('Ctrl+Shift+C copies selected terminal output without sending SIGINT', async () => {
    const readyToken = `OPENCOVE_LINUX_COPY_READY_${Date.now()}`
    const sigintToken = `OPENCOVE_LINUX_COPY_SIGINT_${Date.now()}`
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
          id: 'node-copy-linux',
          title: 'terminal-copy-linux',
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

      await window.keyboard.type(
        `node -e "const ready=process.env.${READY_ENV_KEY};const sigint=process.env.${SIGINT_ENV_KEY};process.on('SIGINT',()=>{console.log(sigint);process.exit(130)});console.log(ready);setInterval(()=>{},1000)"`,
      )
      await window.keyboard.press('Enter')
      await expect(terminal).toContainText(readyToken)

      await expect
        .poll(async () => await selectTerminalOutput(window, 'node-copy-linux'))
        .toMatchObject({
          hasSelection: true,
          selection: expect.stringContaining(readyToken),
        })

      await window.keyboard.press('Control+Shift+C')
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

  test('Ctrl+C still sends SIGINT when nothing is selected', async () => {
    const readyToken = `OPENCOVE_LINUX_SIGINT_READY_${Date.now()}`
    const sigintToken = `OPENCOVE_LINUX_SIGINT_${Date.now()}`
    const { electronApp, window } = await launchApp({
      env: {
        [READY_ENV_KEY]: readyToken,
        [SIGINT_ENV_KEY]: sigintToken,
      },
    })

    try {
      await clearAndSeedWorkspace(window, [
        {
          id: 'node-sigint-linux',
          title: 'terminal-sigint-linux',
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

      await window.keyboard.type(
        `node -e "const ready=process.env.${READY_ENV_KEY};const sigint=process.env.${SIGINT_ENV_KEY};process.on('SIGINT',()=>{console.log(sigint);process.exit(130)});console.log(ready);setInterval(()=>{},1000)"`,
      )
      await window.keyboard.press('Enter')
      await expect(terminal).toContainText(readyToken)

      await window.keyboard.press('Control+C')

      await expect(terminal).toContainText(sigintToken)
    } finally {
      await electronApp.close()
    }
  })
})
