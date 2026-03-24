import { test, expect } from '@playwright/test'
import { launchApp, testWorkspacePath } from './workspace-canvas.helpers'

test.describe('PTY Host Isolation', () => {
  test('should survive pty-host crash and spawn again', async () => {
    const { electronApp, window } = await launchApp()

    try {
      const first = await window.evaluate(async cwd => {
        return await window.opencoveApi.pty.spawn({ cwd, cols: 80, rows: 24 })
      }, testWorkspacePath)

      expect(first.sessionId).toBeTruthy()

      await window.evaluate(async () => {
        await window.opencoveApi.pty.debugCrashHost()
      })

      await window.waitForTimeout(500)

      const second = await window.evaluate(async cwd => {
        return await window.opencoveApi.pty.spawn({ cwd, cols: 80, rows: 24 })
      }, testWorkspacePath)

      expect(second.sessionId).toBeTruthy()
      expect(second.sessionId).not.toBe(first.sessionId)
    } finally {
      await electronApp.close()
    }
  })
})
