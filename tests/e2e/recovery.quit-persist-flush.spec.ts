import { expect, test } from '@playwright/test'
import {
  clearAndSeedWorkspace,
  createTestUserDataDir,
  launchApp,
  removePathWithRetry,
} from './workspace-canvas.helpers'

test.describe('Recovery - Quit Persist Flush', () => {
  test('persists pending workspace state writes when quitting the app (Cmd+Q)', async () => {
    const userDataDir = await createTestUserDataDir()

    try {
      const { electronApp, window } = await launchApp({
        windowMode: 'offscreen',
        userDataDir,
        cleanupUserDataDir: false,
        env: {
          // Artificially slow persistence writes to deterministically reproduce "quit before write completes".
          OPENCOVE_TEST_PERSIST_APP_STATE_WRITE_DELAY_MS: '650',
        },
      })

      try {
        await clearAndSeedWorkspace(window, [])

        const pane = window.locator('.workspace-canvas .react-flow__pane')
        await expect(pane).toBeVisible()

        await pane.click({
          button: 'right',
          position: { x: 240, y: 180 },
        })

        await window.locator('[data-testid="workspace-context-new-note"]').click()
        await expect(window.locator('.note-node')).toHaveCount(1)

        // Simulate Cmd+Q by quitting from main. The app should block quit until persistence flush
        // completes, otherwise the note can be lost on restart.
        await electronApp.evaluate(({ app }) => app.quit()).catch(() => undefined)
      } finally {
        await electronApp.close()
      }

      const { electronApp: restartedApp, window: restartedWindow } = await launchApp({
        windowMode: 'offscreen',
        userDataDir,
        cleanupUserDataDir: true,
        env: {
          OPENCOVE_TEST_PERSIST_APP_STATE_WRITE_DELAY_MS: '650',
        },
      })

      try {
        await expect(restartedWindow.locator('.note-node')).toHaveCount(1, { timeout: 30_000 })
      } finally {
        await restartedApp.close()
      }
    } finally {
      await removePathWithRetry(userDataDir)
    }
  })
})
