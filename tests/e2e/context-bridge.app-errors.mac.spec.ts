import { expect, test } from '@playwright/test'
import { launchApp } from './workspace-canvas.helpers'
import { ready } from './context-bridge.app-errors.helpers'

test('reinstalls after macOS closes and recreates its last window', async () => {
  test.skip(process.platform !== 'darwin', 'macOS last-window lifecycle')
  const { electronApp, window: page } = await launchApp({
    env: { OPENCOVE_TEST_KEEP_APP_ALIVE_ON_WINDOW_ALL_CLOSED: '1' },
  })
  try {
    await ready(page)
    const next = electronApp.waitForEvent('window')
    const atActivation = await electronApp.evaluate(({ app, BrowserWindow }) => {
      const closing = BrowserWindow.getAllWindows()[0]
      return new Promise<{ windowCount: number; nativeClosed: boolean }>(resolve => {
        let nativeClosed = false
        closing.once('closed', () => {
          nativeClosed = true
        })
        // A page close is not a native window close. Pin activation to the real teardown
        // boundary so this covers the race without relying on cross-process scheduling.
        closing.webContents.once('destroyed', () => {
          const state = { windowCount: BrowserWindow.getAllWindows().length, nativeClosed }
          app.emit('activate')
          resolve(state)
        })
        closing.close()
      })
    })
    await test.info().attach('last-window-activation-state', {
      body: JSON.stringify(atActivation),
      contentType: 'application/json',
    })
    expect(atActivation).toEqual({ windowCount: 1, nativeClosed: false })
    await ready(await next)
    expect(
      await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length),
    ).toBe(1)
  } finally {
    await electronApp.close()
  }
})
