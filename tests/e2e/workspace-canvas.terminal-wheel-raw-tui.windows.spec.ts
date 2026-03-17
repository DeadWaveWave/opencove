import path from 'node:path'
import { expect, test } from '@playwright/test'
import { clearAndSeedWorkspace, launchApp, testWorkspacePath } from './workspace-canvas.helpers'

type WorkspaceWindow = Awaited<ReturnType<typeof launchApp>>['window']

const windowsOnly = process.platform !== 'win32'
const stubScriptPath = path.join(testWorkspacePath, 'scripts', 'test-agent-session-stub.mjs')

async function dispatchTerminalWheel(
  window: WorkspaceWindow,
  selector: string,
  eventInit: Partial<WheelEventInit>,
): Promise<void> {
  await window.evaluate(
    ({ selector: wheelTargetSelector, event }) => {
      const target = document.querySelector(wheelTargetSelector)
      if (!(target instanceof HTMLElement)) {
        return
      }

      const rect = target.getBoundingClientRect()
      target.dispatchEvent(
        new WheelEvent('wheel', {
          deltaX: 0,
          deltaY: 0,
          deltaMode: 0,
          bubbles: true,
          cancelable: true,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
          ...event,
        }),
      )
    },
    { selector, event: eventInit },
  )
}

test.describe('Workspace Canvas - Terminal Wheel Raw TUI (Windows)', () => {
  test.skip(windowsOnly, 'Windows only')

  test('forwards wheel input to an alternate-screen codex-style TUI', async () => {
    const { electronApp, window } = await launchApp({ cleanupUserDataDir: false })

    try {
      await clearAndSeedWorkspace(window, [
        {
          id: 'node-raw-wheel-windows',
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

      await dispatchTerminalWheel(window, '.terminal-node .xterm-screen', {
        deltaY: -240,
      })

      await expect(terminal).toContainText('[cove-test-wheel] wheel-up')
      await expect(terminal).not.toContainText('[cove-test-wheel] timeout')
    } finally {
      await electronApp.close()
    }
  })
})
