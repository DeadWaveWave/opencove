import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { clearAndSeedWorkspace, launchApp } from './workspace-canvas.helpers'

/** The header's own left padding, and the room macOS keeps for the traffic lights beside it. */
const HEADER_PADDING = 10
const TRAFFIC_LIGHTS = 72

/**
 * E2E windows sit off screen, where macOS cannot take them full screen, so the test raises the
 * window's own full-screen events: everything from the main process listener on is real.
 */
async function emitFullScreen(electronApp: ElectronApplication, fullScreen: boolean) {
  await electronApp.evaluate(({ BrowserWindow }, entering) => {
    BrowserWindow.getAllWindows()[0]!.emit(entering ? 'enter-full-screen' : 'leave-full-screen')
  }, fullScreen)
}

async function toggleInset(window: Page): Promise<number> {
  return await window.getByTestId('app-header-sidebar-toggle').evaluate(button => {
    const header = button.closest('.app-header')!.getBoundingClientRect()
    return Math.round(button.getBoundingClientRect().left - header.left)
  })
}

test.describe('App header - full screen', () => {
  test('the sidebar toggle moves into the room the traffic lights leave in full screen', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(window, [])
      const platform = await electronApp.evaluate(() => process.platform)
      const windowed = platform === 'darwin' ? HEADER_PADDING + TRAFFIC_LIGHTS : HEADER_PADDING
      await expect.poll(() => toggleInset(window)).toBe(windowed)

      await emitFullScreen(electronApp, true)
      await expect.poll(() => toggleInset(window)).toBe(HEADER_PADDING)

      await emitFullScreen(electronApp, false)
      await expect.poll(() => toggleInset(window)).toBe(windowed)
    } finally {
      await electronApp.close()
    }
  })
})
